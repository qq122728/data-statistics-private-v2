import { ChangePasswordForm } from "../../../../packages/auth/ChangePasswordForm";
import { adminPath } from "@/lib/app-path";

export default function ChangePasswordPage() {
  return <ChangePasswordForm loginHref={adminPath("/login")} cancelHref={adminPath("/")} />;
}
