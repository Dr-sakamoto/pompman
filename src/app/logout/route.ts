import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SESSION_BACKUP_COOKIE } from "@/lib/supabase/session-backup";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL("/login", request.nextUrl.origin), {
    status: 303,
  });
  // 控えも消す。残っていると middleware がセッションを作り直してしまう。
  response.cookies.delete(SESSION_BACKUP_COOKIE);
  return response;
}
