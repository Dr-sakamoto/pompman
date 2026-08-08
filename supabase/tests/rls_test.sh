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
truncate public.picks, public.answers, public.odai, public.users, auth.users restart identity cascade;
insert into auth.users(id,email) values
  ('$ALICE','a@x.test'), ('$BOB','b@x.test'), ('$CAROL','c@x.test');
insert into public.users(id,handle,terms_accepted_at) values
  ('$ALICE','alice',now()), ('$BOB','bob',now()), ('$CAROL','carol',now());
SQL

echo
echo "== phase: answering =="
ok   "alice が自分名義でお題を作れる"        $ALICE "insert into odai(author_id,text) values ('$ALICE','冷蔵庫を開けたら○○');"
deny "bob が alice 名義でお題を作れない"     $BOB   "insert into odai(author_id,text) values ('$ALICE','なりすまし');"
deny "voting 状態のお題を直接作れない"       $ALICE "insert into odai(author_id,text,phase) values ('$ALICE','x','voting');"

ok   "alice が回答できる"                    $ALICE "insert into answers(odai_id,author_id,text) values (1,'$ALICE','アリスの回答');"
ok   "bob が回答できる"                      $BOB   "insert into answers(odai_id,author_id,text) values (1,'$BOB','ボブの回答');"
deny "1人2回答はできない"                    $BOB   "insert into answers(odai_id,author_id,text) values (1,'$BOB','ボブの2つめ');"
deny "他人名義の回答は投稿できない"          $BOB   "insert into answers(odai_id,author_id,text) values (1,'$CAROL','なりすまし');"

deny "answers を直接 SELECT できない"        $BOB   "select * from answers;"
deny "answers を直接 UPDATE できない"        $BOB   "update answers set text='改ざん' where author_id='$BOB';"
deny "answers を直接 DELETE できない"        $BOB   "delete from answers where author_id='$BOB';"

eq   "回答受付中: bob に見える回答は自分の1件だけ" "1" $BOB "select count(*) from answers_view where odai_id=1;"
eq   "回答受付中: carol には0件"                   "0" $CAROL "select count(*) from answers_view where odai_id=1;"
eq   "回答受付中: 回答者数も漏れない(carol)"       "0" $CAROL "select count(*) from answers_view;"

deny "回答受付中は投票できない"              $BOB   "select submit_picks(1, array[1]::bigint[]);"
deny "回答受付中は picks を直接入れられない" $BOB   "insert into picks(odai_id,voter_id,answer_id,rank) values (1,'$BOB',1,1);"

deny "作成者以外は締め切れない"              $BOB   "select close_answers(1);"
deny "投票中でないのに close_voting できない" $ALICE "select close_voting(1);"
ok   "作成者が回答を締め切れる"              $ALICE "select close_answers(1);"
deny "二重に締め切れない"                    $ALICE "select close_answers(1);"

echo
echo "== phase: voting =="
eq   "投票中: carol に全2件見える"                 "2" $CAROL "select count(*) from answers_view where odai_id=1;"
eq   "投票中: 回答者名は伏せられている"            "0" $CAROL "select count(*) from answers_view where odai_id=1 and author_id is not null;"
eq   "投票中: 自分の回答だけは自分と分かる"        "1" $BOB   "select count(*) from answers_view where odai_id=1 and is_mine;"
deny "投票中でも回答は追加できない"          $CAROL "insert into answers(odai_id,author_id,text) values (1,'$CAROL','遅刻回答');"

deny "自分の回答は選べない"                  $ALICE "select submit_picks(1, array[1]::bigint[]);"
deny "自分の回答は直接 insert でも選べない"  $ALICE "insert into picks(odai_id,voter_id,answer_id,rank) values (1,'$ALICE',1,1);"
deny "他人名義で投票できない"                $ALICE "insert into picks(odai_id,voter_id,answer_id,rank) values (1,'$BOB',1,1);"
deny "選べる数より多く選べない"              $ALICE "select submit_picks(1, array[2,1]::bigint[]);"
ok   "alice が bob の回答を選ぶ"             $ALICE "select submit_picks(1, array[2]::bigint[]);"
ok   "alice が選び直せる"                    $ALICE "select submit_picks(1, array[2]::bigint[]);"
eq   "alice の picks は1件"                        "1" $ALICE "select count(*) from picks where voter_id='$ALICE';"
eq   "投票中は他人の picks が読めない"             "0" $CAROL "select count(*) from picks where odai_id=1;"
eq   "この時点ではまだ voting"                     "voting" $CAROL "select phase from odai where id=1;"

ok   "bob が alice の回答を選ぶ（全回答者が投票完了）" $BOB "select submit_picks(1, array[1]::bigint[]);"

echo
echo "== phase: closed（自動遷移） =="
eq   "回答者全員の投票完了で closed になる"        "closed" $CAROL "select phase from odai where id=1;"
eq   "結果公開後は回答者名が開示される"            "2" $CAROL "select count(*) from answers_view where odai_id=1 and author_id is not null;"
eq   "結果公開後は他人の picks も読める"           "2" $CAROL "select count(*) from picks where odai_id=1;"
deny "closed 後は投票できない"               $CAROL "select submit_picks(1, array[1]::bigint[]);"
ok   "closed 後の DELETE は0件に絞られる"    $ALICE "delete from picks where voter_id='$ALICE';"
eq   "alice の picks は消えていない"               "1" $ALICE "select count(*) from picks where voter_id='$ALICE';"
deny "role の自己昇格はできない"             $BOB   "update users set role='admin' where id='$BOB';"
eq   "bob の role は member のまま"                "member" $BOB "select role from users where id='$BOB';"
ok   "handle は自分で変更できる"             $BOB   "update users set handle='bob2' where id='$BOB';"

echo
echo "== 2つめのお題: 5人回答・誰にも選ばれない回答あり =="
$PSQL -v ON_ERROR_STOP=1 <<SQL
insert into auth.users(id,email) values ('$DAVE','d@x.test'), ('$ERIN','e@x.test');
insert into public.users(id,handle,terms_accepted_at) values
  ('$DAVE','dave',now()), ('$ERIN','erin',now());
SQL
ok   "carol がお題を作る" $CAROL "insert into odai(author_id,text) values ('$CAROL','最悪の目覚まし時計とは');"
O2=$($PSQL -c "select max(id) from odai;")
ok   "alice 回答" $ALICE "insert into answers(odai_id,author_id,text) values ($O2,'$ALICE','A の回答');"
ok   "bob 回答"   $BOB   "insert into answers(odai_id,author_id,text) values ($O2,'$BOB','B の回答');"
ok   "carol 回答" $CAROL "insert into answers(odai_id,author_id,text) values ($O2,'$CAROL','C の回答');"
ok   "dave 回答"  $DAVE  "insert into answers(odai_id,author_id,text) values ($O2,'$DAVE','D の回答');"
ok   "erin 回答"  $ERIN  "insert into answers(odai_id,author_id,text) values ($O2,'$ERIN','E の回答（全員にスベる）');"
ok   "carol が締め切る"  $CAROL "select close_answers($O2);"

aid() { $PSQL -c "select id from answers where odai_id=$O2 and author_id='$1';"; }
A=$(aid $ALICE); B=$(aid $BOB); C=$(aid $CAROL); D=$(aid $DAVE); E=$(aid $ERIN)
OLD=$($PSQL -c "select id from answers where odai_id=1 limit 1;")

deny "3位まで選ばないと提出できない" $ALICE "select submit_picks($O2, array[$B,$C]::bigint[]);"
deny "4つは選べない"                 $ALICE "select submit_picks($O2, array[$B,$C,$D,$E]::bigint[]);"
deny "同じ回答を2つの順位に選べない" $ALICE "select submit_picks($O2, array[$B,$B,$C]::bigint[]);"
deny "他のお題の回答は混ぜられない"  $ALICE "select submit_picks($O2, array[$OLD,$B,$C]::bigint[]);"

ok   "alice が投票"  $ALICE "select submit_picks($O2, array[$B,$C,$D]::bigint[]);"
ok   "bob が投票"    $BOB   "select submit_picks($O2, array[$A,$C,$D]::bigint[]);"
ok   "carol が投票"  $CAROL "select submit_picks($O2, array[$A,$B,$D]::bigint[]);"
ok   "dave が投票"   $DAVE  "select submit_picks($O2, array[$A,$B,$C]::bigint[]);"
eq   "erin 未投票なのでまだ voting" "voting" $ALICE "select phase from odai where id=$O2;"
ok   "erin が投票"   $ERIN  "select submit_picks($O2, array[$A,$B,$C]::bigint[]);"
eq   "全回答者の投票完了で closed"  "closed" $ALICE "select phase from odai where id=$O2;"
eq   "erin の回答は誰にも選ばれていない" "0" $ALICE "select count(*) from picks where answer_id=$E;"
eq   "結果公開後は5件すべて見える（0票の回答も消えない）" "5" $ALICE "select count(*) from answers_view where odai_id=$O2;"

echo
echo "== 仕様書 §8 の導出クエリ =="

echo "(A) 選好ペア:"
$PSQL <<'SQL'
select p.voter_id, p.odai_id, p.answer_id as chosen_id, a_rej.id as rejected_id
from picks p
join answers a_rej
  on a_rej.odai_id = p.odai_id
 and a_rej.id <> p.answer_id
 and a_rej.author_id <> p.voter_id
 and a_rej.id not in (select answer_id from picks where odai_id = p.odai_id and voter_id = p.voter_id);
SQL
echo "(B) 誰からも選ばれなかった回答:"
$PSQL -c "select a.id, a.text from answers a left join picks p on p.answer_id = a.id where p.id is null;"
echo "(C) 特定メンバーの picks:"
$PSQL -c "select odai_id, answer_id, rank from picks where voter_id = '$ALICE';"

echo
echo "================ pass=$pass fail=$fail ================"
[ $fail -eq 0 ]
