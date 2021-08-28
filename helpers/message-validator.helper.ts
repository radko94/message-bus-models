export const validateMessageInput = (input: any): boolean =>
  Boolean(input?.eventName) && Boolean(input?.data);
