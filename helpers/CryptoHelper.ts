import {
  Cipher,
  Decipher,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "crypto";

export class CryptoHelper {
  public static ENCRYPT(secureKey: string, text: string): string {
    const encryptedKey: string = createHash("md5")
      .update(secureKey)
      .digest("hex");

    const cipher: Cipher = createCipheriv(
      "aes-256-cbc",
      Buffer.from(encryptedKey),
      encryptedKey.substr(0, 16)
    );

    return cipher.update(text, "utf8", "hex") + cipher.final("hex");
  }

  public static DECRYPT(secureKey: string, text: string): string {
    const encryptedKey: string = createHash("md5")
      .update(secureKey)
      .digest("hex");

    const decipher: Decipher = createDecipheriv(
      "aes-256-cbc",
      Buffer.from(encryptedKey),
      encryptedKey.substr(0, 16)
    );

    return decipher.update(text, "hex", "utf8") + decipher.final("utf8");
  }
}
