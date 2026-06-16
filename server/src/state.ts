/** Mutable runtime state shared across modules (e.g. the boot Slack auth check). */
export const runtimeState: { slackOk: boolean | null } = {
  slackOk: null,
};
