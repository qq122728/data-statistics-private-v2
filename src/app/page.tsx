import { redirect } from "next/navigation";
import { AuthenticationError, requireUser } from "../lib/auth";

export default async function HomePage() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      redirect("/login?next=/");
    }
    throw error;
  }

  redirect("/dashboard");
}
