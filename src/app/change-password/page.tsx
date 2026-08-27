import { redirect } from "next/navigation";

import { ChangePasswordForm } from "../../components/auth/ChangePasswordForm";
import { AuthenticationError, requireUser } from "../../lib/auth";

export default async function ChangePasswordPage() {
  let user;
  try {
    user = await requireUser({ allowPasswordChangeRequired: true });
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/change-password");
    throw error;
  }

  return (
    <main className="page-shell space-y-5">
      <div className="page-heading">
        <div>
          <h1 className="page-title">账号安全</h1>
          <p className="page-description">修改你自己的登录密码，所有账号都可以使用。</p>
        </div>
      </div>
      <ChangePasswordForm userName={user.name} />
    </main>
  );
}
