export type LeadPeriodActivity = {
  leadId: string;
  kind: string;
  lead: {
    repliedOn: string | null;
    joinedOn: string | null;
    expertIntroducedOn: string | null;
    registeredOn: string | null;
  };
};

function distinctCurrentCustomers(
  activities: LeadPeriodActivity[],
  kind: "REPLIED" | "JOINED_GROUP" | "EXPERT_INTRODUCED" | "REGISTERED",
  isStillCompleted: (lead: LeadPeriodActivity["lead"]) => boolean,
) {
  return new Set(
    activities
      .filter((activity) => activity.kind === kind && isStillCompleted(activity.lead))
      .map((activity) => activity.leadId),
  ).size;
}

export function countLeadPeriodCompletions(activities: LeadPeriodActivity[]) {
  return {
    replied: distinctCurrentCustomers(activities, "REPLIED", (lead) => Boolean(lead.repliedOn)),
    joined: distinctCurrentCustomers(activities, "JOINED_GROUP", (lead) => Boolean(lead.joinedOn)),
    introduced: distinctCurrentCustomers(activities, "EXPERT_INTRODUCED", (lead) => Boolean(lead.expertIntroducedOn)),
    registered: distinctCurrentCustomers(activities, "REGISTERED", (lead) => Boolean(lead.registeredOn)),
  };
}
