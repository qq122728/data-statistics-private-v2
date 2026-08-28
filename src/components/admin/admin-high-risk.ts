export type HighRiskCredentials = {
  highRiskReason: string;
  currentPassword: string;
};

export type MemberHighRiskOperation =
  | "admin-privilege"
  | "admin-password-reset"
  | "admin-access-revocation"
  | "admin-reactivation";

export function getMemberHighRiskOperation(
  input: {
    previousRole: string | null;
    nextRole: string;
    previousActive: boolean | null;
    nextActive: boolean;
    hasNewPassword: boolean;
  },
): MemberHighRiskOperation | null {
  if (input.nextRole === "ADMIN" && input.previousRole !== "ADMIN") {
    return "admin-privilege";
  }
  if (
    input.previousRole === "ADMIN" &&
    input.previousActive === false &&
    input.nextRole === "ADMIN" &&
    input.nextActive
  ) {
    return "admin-reactivation";
  }
  if (
    input.previousRole === "ADMIN" &&
    input.previousActive === true &&
    !input.nextActive
  ) {
    return "admin-access-revocation";
  }
  if (input.previousRole === "ADMIN" && input.nextRole !== "ADMIN") {
    return "admin-access-revocation";
  }
  if (input.previousRole === "ADMIN" && input.hasNewPassword) {
    return "admin-password-reset";
  }
  return null;
}

export function requiresAdminPrivilegeConfirmation(
  previousRole: string | null,
  nextRole: string,
): boolean {
  return (
    getMemberHighRiskOperation({
      previousRole,
      nextRole,
      previousActive: null,
      nextActive: true,
      hasNewPassword: false,
    }) ===
    "admin-privilege"
  );
}
