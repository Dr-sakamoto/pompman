#!/usr/bin/env bash
# RLS / フェーズ制御の検証
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U postgres -d odai -qAt"
ALICE=11111111-1111-1111-1111-111111111111
BOB=22222222-2222-2222-2222-222222222222
CAROL=33333333-3333-3333-3333-333333333333
DAVE=44444444-4444-4444-4444-444444444444
ERIN=55555555-5555-5555-5555-555555555555

pass=0; fail=0

# as <uid> <sql>  — authenticated として実行
as() {
  local uid="$1"; shift
  $PSQL -v ON_ERROR_STOP=1 <<SQL 2>&1
set role authenticated;
set request.jwt.claim.sub = '$uid';
set request.jwt.claim.role = 'authenticated';
$*
SQL
}

ok() { # ok <desc> <uid> <sql>
  local desc="$1" uid="$2"; shift 2
  local out; out=$(as "$uid" "$@")
  if [ $? -eq 0 ]; then echo "  PASS  $desc"; pass=$((pass+1));
  else echo "  FAIL  $desc"; echo "$out" | sed 's/^/        /'; fail=$((fail+1)); fi
}

deny() { # deny <desc> <uid> <sql>
  local desc="$1" uid="$2"; shift 2
  local out; out=$(as "$uid" "$@")
  if [ $? -ne 0 ]; then echo "  PASS  $desc  -> $(echo "$out" | grep -m1 -E 'ERROR|error' | cut -c1-110)"; pass=$((pass+1));
  else echo "  FAIL  $desc  (通ってしまった)"; fail=$((fail+1)); fi
}

eq() { # eq <desc> <expected> <uid> <sql>
  local desc="$1" want="$2" uid="$3"; shift 3
  local got; got=$(as "$uid" "$@" | tail -1)
  if [ "$got" == "$want" ]; then echo "  PASS  $desc  = $got"; pass=$((pass+1));
  else echo "  FAIL  $desc  期待:[$want] 実際:[$got]"; fail=$((fail+1)); fi
}

echo "== seed =="
$PSQL -v ON_ERROR_STOP=1 <<SQL
truncate public.picks, public.answer_unlocks, public.answers, public.odai, public.users, auth.users restart identity cascade;
insert into auth.users(id,email) values
  ('$ALICE','a@x.test'), ('$BOB','b@x.test'), ('$CAROL','c@x.test');
insert into public.users(id,handle,terms_accepted_at) values
  ('$ALICE','alice',now()), ('$BOB','bob',now()), ('$CAROL','carol',now());
SQL

echo
echo "== phase: open（回答と採点が同居する） =="
ok   "alice が自分名義でお題を作れる"        $ALICE "insert into odai(author_id,text) values ('$ALICE','冷蔵庫を開けたら○○');"
deny "bob が alice 名義でお題を作れない"     $BOB   "insert into odai(author_id,text) values ('$ALICE','なりすまし');"
deny "closed 状態のお題を直接作れない"       $ALICE "insert into odai(author_id,text,phase) values ('$ALICE','x','closed');"
eq   "作ったお題は open で始まる"                  "open" $ALICE "select phase from odai where id=1;"

ok   "alice が回答できる"                    $ALICE "insert into answers(odai_id,author_id,text) values (1,'$ALICE','アリスの回答');"
ok   "bob が回答できる"                      $BOB   "insert into answers(odai_id,author_id,text) values (1,'$BOB','ボブの回答');"
ok   "bob が2つめの回答も出せる"             $BOB   "insert into answers(odai_id,author_id,text) values (1,'$BOB','ボブの2つめ');"
deny "他人名義の回答は投稿できない"          $BOB   "insert into answers(odai_id,author_id,text) values (1,'$CAROL','なりすまし');"

deny "answers を直接 SELECT できない"        $BOB   "select * from answers;"
deny "answers を直接 UPDATE できない"        $BOB   "update answers set text='改ざん' where author_id='$BOB';"
deny "answers を直接 DELETE できない"        $BOB   "delete from answers where author_id='$BOB';"

A1=$($PSQL -c "select id from answers where odai_id=1 and author_id='$ALICE' order by id limit 1;")
B1=$($PSQL -c "select id from answers where odai_id=1 and author_id='$BOB' order by id limit 1;")
B2=$($PSQL -c "select id from answers where odai_id=1 and author_id='$BOB' order by id offset 1 limit 1;")

echo
echo "-- 回答するだけでは他人の回答は見えない・解禁も採点もできない --"
eq   "未回答の carol には1件も見えない"            "0" $CAROL "select count(*) from answers_view where odai_id=1;"
eq   "未回答でも回答数だけは分かる"                "3" $CAROL "select answer_count from odai_answer_counts() where odai_id=1;"
deny "回答していないと解禁できない"          $CAROL "select unlock_answers(1);"
deny "回答していないと解禁ログも直接は作れない" $CAROL "insert into answer_unlocks(odai_id,user_id) values (1,'$CAROL');"
eq   "回答しただけでは他人の回答は見えない(bob)"   "2" $BOB "select count(*) from answers_view where odai_id=1;"
deny "解禁前は採点できない(bob)"             $BOB   "select submit_picks(1, array[$A1]::bigint[]);"
deny "解禁前は picks を直接入れられない(bob)" $BOB  "insert into picks(odai_id,voter_id,answer_id,rank) values (1,'$BOB',$A1,1);"

echo
echo "-- 出し切ってから解禁すると全部見えて採点できる。解禁は片道切符 --"
ok   "bob が解禁する"                        $BOB   "select unlock_answers(1);"
eq   "解禁した瞬間に全部見える(bob)"               "3" $BOB "select count(*) from answers_view where odai_id=1;"
eq   "誰が書いたかは伏せられている"                "0" $BOB "select count(*) from answers_view where odai_id=1 and author_id is not null and not is_mine;"
deny "解禁後は回答を追加できない(bob)"       $BOB   "insert into answers(odai_id,author_id,text) values (1,'$BOB','解禁後の回答');"
deny "二重に解禁できない(bob)"               $BOB   "select unlock_answers(1);"
ok   "bob がそのまま採点できる"              $BOB   "select submit_picks(1, array[$A1]::bigint[]);"
deny "自分の回答は選べない(bob)"             $BOB   "select submit_picks(1, array[$B1]::bigint[]);"
deny "他人名義で採点できない"                $ALICE "insert into picks(odai_id,voter_id,answer_id,rank) values (1,'$BOB',$A1,1);"

echo
echo "-- 誰かが解禁したあとでも、まだ解禁していない人は回答を書き足せる --"
ok   "carol が回答する（まだ未解禁）"        $CAROL "insert into answers(odai_id,author_id,text) values (1,'$CAROL','キャロルの回答');"
C1=$($PSQL -c "select id from answers where odai_id=1 and author_id='$CAROL' order by id limit 1;")
eq   "解禁済みの bob にも carol の新しい回答が見える" "4" $BOB "select count(*) from answers_view where odai_id=1;"
eq   "carol 自身はまだ他人の回答が見えない"        "1" $CAROL "select count(*) from answers_view where odai_id=1;"

ok   "carol が解禁する"                      $CAROL "select unlock_answers(1);"
eq   "carol も解禁すれば全部見える"                "4" $CAROL "select count(*) from answers_view where odai_id=1;"
deny "同じ回答を2つの順位に選べない"         $CAROL "select submit_picks(1, array[$A1,$A1]::bigint[]);"
ok   "carol が alice と bob の回答を選ぶ"    $CAROL "select submit_picks(1, array[$A1,$B1]::bigint[]);"

ok   "alice が解禁する"                      $ALICE "select unlock_answers(1);"
deny "自分の回答は選べない(alice)"           $ALICE "select submit_picks(1, array[$A1]::bigint[]);"
deny "自分の回答は直接 insert でも選べない"  $ALICE "insert into picks(odai_id,voter_id,answer_id,rank) values (1,'$ALICE',$A1,1);"
ok   "alice が bob と carol の回答を選ぶ"    $ALICE "select submit_picks(1, array[$B2,$B1,$C1]::bigint[]);"
ok   "alice が選び直せる"                    $ALICE "select submit_picks(1, array[$B1]::bigint[]);"
eq   "選び直すと前の picks は残らない"             "1" $ALICE "select count(*) from picks where voter_id='$ALICE';"
eq   "採点中は自分の分しか見えない(bob、全体は4件)" "1" $BOB   "select count(*) from picks where odai_id=1;"

echo
echo "== phase: closed（結果発表） =="
deny "作成者以外は締め切れない"              $BOB   "select close_odai(1);"
ok   "作成者が締め切れる"                    $ALICE "select close_odai(1);"
deny "二重に締め切れない"                    $ALICE "select close_odai(1);"
eq   "phase は closed"                             "closed" $CAROL "select phase from odai where id=1;"
eq   "closed_at が入る"                            "t" $CAROL "select closed_at is not null from odai where id=1;"

deny "closed 後は回答できない"               $CAROL "insert into answers(odai_id,author_id,text) values (1,'$CAROL','遅刻回答');"
deny "closed 後は採点できない"               $CAROL "select submit_picks(1, array[$A1]::bigint[]);"
eq   "結果発表後は回答者名が開示される"            "4" $CAROL "select count(*) from answers_view where odai_id=1 and author_id is not null;"
eq   "結果発表後は他人の picks も読める"           "4" $BOB   "select count(*) from picks where odai_id=1;"
ok   "closed 後の DELETE は0件に絞られる"    $ALICE "delete from picks where voter_id='$ALICE';"
eq   "alice の picks は消えていない"               "1" $ALICE "select count(*) from picks where voter_id='$ALICE';"
deny "role の自己昇格はできない"             $BOB   "update users set role='admin' where id='$BOB';"
eq   "bob の role は member のまま"                "member" $BOB "select role from users where id='$BOB';"
ok   "handle は自分で変更できる"             $BOB   "update users set handle='bob2' where id='$BOB';"

echo
echo "== 1人あたりの回答数の上限 =="
$PSQL -v ON_ERROR_STOP=1 <<SQL
insert into auth.users(id,email) values ('$DAVE','d@x.test'), ('$ERIN','e@x.test');
insert into public.users(id,handle,terms_accepted_at) values
  ('$DAVE','dave',now()), ('$ERIN','erin',now());
SQL
eq   "結果発表後は、回答していない人にも全部見える" "4" $DAVE \
     "select count(*) from answers_view where odai_id=1;"

ok   "dave がお題を作る" $DAVE "insert into odai(author_id,text) values ('$DAVE','限界に挑むお題');"
O2=$($PSQL -c "select max(id) from odai;")

for i in $(seq 1 10); do
  ok "erin の${i}個目の回答" $ERIN "insert into answers(odai_id,author_id,text) values ($O2,'$ERIN','erin $i');"
done
deny "11個目は入らない" $ERIN "insert into answers(odai_id,author_id,text) values ($O2,'$ERIN','erin 11');"
deny "まとめて INSERT しても上限は超えられない" $DAVE \
     "insert into answers(odai_id,author_id,text) select $O2,'$DAVE','bulk '||g from generate_series(1,11) g;"
eq   "上限超えの一括 INSERT は1件も残らない" "0" $DAVE "select count(*) from answers_view where odai_id=$O2 and is_mine;"
ok   "10件までなら一括でも入る" $DAVE \
     "insert into answers(odai_id,author_id,text) select $O2,'$DAVE','bulk '||g from generate_series(1,10) g;"
deny "そのうえ1件は入らない" $DAVE "insert into answers(odai_id,author_id,text) values ($O2,'$DAVE','あと1個');"
eq   "上限はお題ごと（別のお題には出せる）" "1" $ERIN \
     "insert into odai(author_id,text) values ('$ERIN','別のお題'); insert into answers(odai_id,author_id,text) values (currval('odai_id_seq'),'$ERIN','別のお題への回答'); select count(*) from answers_view where odai_id=currval('odai_id_seq') and is_mine;"

echo
echo "== 5人・複数回答・誰にも選ばれない回答あり =="
ok   "carol がお題を作る" $CAROL "insert into odai(author_id,text) values ('$CAROL','最悪の目覚まし時計とは');"
O3=$($PSQL -c "select max(id) from odai;")
ok   "alice 回答"        $ALICE "insert into answers(odai_id,author_id,text) values ($O3,'$ALICE','A の回答');"
ok   "bob 回答"          $BOB   "insert into answers(odai_id,author_id,text) values ($O3,'$BOB','B の回答');"
ok   "carol 回答"        $CAROL "insert into answers(odai_id,author_id,text) values ($O3,'$CAROL','C の回答');"
ok   "dave 回答"         $DAVE  "insert into answers(odai_id,author_id,text) values ($O3,'$DAVE','D の回答');"
ok   "erin 回答"         $ERIN  "insert into answers(odai_id,author_id,text) values ($O3,'$ERIN','E の回答（全員にスベる）');"
ok   "erin が2つめも出す（解禁前ならまだ書き足せる）" $ERIN \
     "insert into answers(odai_id,author_id,text) values ($O3,'$ERIN','E の2つめ（これもスベる）');"

aid() { $PSQL -c "select id from answers where odai_id=$O3 and author_id='$1' order by id limit 1;"; }
A=$(aid $ALICE); B=$(aid $BOB); C=$(aid $CAROL); D=$(aid $DAVE); E=$(aid $ERIN)
E2=$($PSQL -c "select id from answers where odai_id=$O3 and author_id='$ERIN' order by id offset 1 limit 1;")

deny "解禁前は採点できない(alice)" $ALICE "select submit_picks($O3, array[$B]::bigint[]);"

ok   "alice が解禁する"              $ALICE "select unlock_answers($O3);"
deny "4つは選べない"                 $ALICE "select submit_picks($O3, array[$B,$C,$D,$E]::bigint[]);"
deny "同じ回答を2つの順位に選べない" $ALICE "select submit_picks($O3, array[$B,$B,$C]::bigint[]);"
deny "他のお題の回答は混ぜられない"  $ALICE "select submit_picks($O3, array[$A1,$B,$C]::bigint[]);"
ok   "alice が採点"                  $ALICE "select submit_picks($O3, array[$B,$C,$D]::bigint[]);"

ok   "bob が解禁する"    $BOB   "select unlock_answers($O3);"
ok   "bob が採点"        $BOB   "select submit_picks($O3, array[$A,$C,$D]::bigint[]);"
ok   "carol が解禁する"  $CAROL "select unlock_answers($O3);"
ok   "carol が採点"      $CAROL "select submit_picks($O3, array[$A,$B,$D]::bigint[]);"
ok   "dave が解禁する"   $DAVE  "select unlock_answers($O3);"
ok   "dave が採点"       $DAVE  "select submit_picks($O3, array[$A,$B,$C]::bigint[]);"
ok   "erin が解禁する"   $ERIN  "select unlock_answers($O3);"
ok   "erin が採点"       $ERIN  "select submit_picks($O3, array[$A,$B,$C]::bigint[]);"
eq   "全員が採点しても自動では締まらない" "open" $ALICE "select phase from odai where id=$O3;"
ok   "出題者が締め切る" $CAROL "select close_odai($O3);"
eq   "締め切って closed"           "closed" $ALICE "select phase from odai where id=$O3;"
eq   "erin の回答は誰にも選ばれていない" "0" $ALICE "select count(*) from picks where answer_id in ($E,$E2);"
eq   "結果発表後は6件すべて見える（0票の回答も消えない）" "6" $ALICE "select count(*) from answers_view where odai_id=$O3;"

# answers は authenticated に直接 SELECT を許していないので、この不変条件の検証だけは
# RLS を経由しない superuser 接続（$PSQL 単体）で行う。
violations=$($PSQL -c "select count(*) from answers a join answer_unlocks u on u.odai_id = a.odai_id and u.user_id = a.author_id where a.created_at > u.unlocked_at;")
if [ "$violations" == "0" ]; then
  echo "  PASS  解禁後に書かれた回答は1件も無い（全お題ぶん）  = 0"; pass=$((pass+1));
else
  echo "  FAIL  解禁後に書かれた回答は1件も無い（全お題ぶん）  期待:[0] 実際:[$violations]"; fail=$((fail+1));
fi

echo
echo "== 仕様書 §8 の導出クエリ =="

echo "(A) 選好ペア（先頭5件）:"
$PSQL <<'SQL'
select p.voter_id, p.odai_id, p.answer_id as chosen_id, a_rej.id as rejected_id
from picks p
join answers a_rej
  on a_rej.odai_id = p.odai_id
 and a_rej.id <> p.answer_id
 and a_rej.author_id <> p.voter_id
 and a_rej.id not in (select answer_id from picks where odai_id = p.odai_id and voter_id = p.voter_id)
order by p.odai_id, p.voter_id, p.answer_id
limit 5;
SQL
echo "(B) 誰からも選ばれなかった回答（件数）:"
$PSQL -c "select count(*) from answers a left join picks p on p.answer_id = a.id where p.id is null;"
echo "(C) 特定メンバーの picks:"
$PSQL -c "select odai_id, answer_id, rank from picks where voter_id = '$ALICE' order by odai_id, rank;"
echo "(D) 「解禁後に書かれた回答」が無いことの検証（0件であるべき）:"
$PSQL -c "select count(*) from answers a join answer_unlocks u on u.odai_id = a.odai_id and u.user_id = a.author_id where a.created_at > u.unlocked_at;"

echo
echo "================ pass=$pass fail=$fail ================"
[ $fail -eq 0 ]
