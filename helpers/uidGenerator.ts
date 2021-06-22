import { createHash } from "crypto";

export const uidGenerator = () =>
  createHash("md5")
    .update(new Date().getTime().toString() + (Math.random() * 1000).toString())
    .digest("hex");
