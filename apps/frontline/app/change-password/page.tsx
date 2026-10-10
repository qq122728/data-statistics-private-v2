import { ChangePasswordForm } from "../../../../packages/auth/ChangePasswordForm";

export default function ChangePasswordPage() {
  return <ChangePasswordForm loginHref="/login" cancelHref="/" />;
}
