import { redirect } from "next/navigation";
import { AuthenticationError, requireUser } from "../../../lib/auth";

/** 旧网址兼容：历史补录已经统一到专家管理，不能再走第二套录入逻辑。 */
export default async function LegacyCustomersPage() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      redirect("/login?next=/expert-customers");
    throw error;
  }
  redirect("/expert-customers");
}
