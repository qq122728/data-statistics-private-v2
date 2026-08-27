import { LoginForm } from "../../components/auth/LoginForm";
import { getSystemSettings } from "../../lib/settings";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const settings = await getSystemSettings();
  return <LoginForm appName={settings.appName} />;
}
