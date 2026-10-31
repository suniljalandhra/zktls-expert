// A rejection we expect and can show the user (bad proof, wrong wallet, duplicate...).
// Anything else is an internal error and gets a generic message.
export class CheckError extends Error {}
