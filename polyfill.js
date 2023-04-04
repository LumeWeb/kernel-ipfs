import { Crypto } from "@peculiar/webcrypto";
import { Buffer } from "buffer";

let globalCrypto = self.crypto;
if (!globalCrypto.subtle) {
  let subtleCrypto = new Crypto().subtle;
  Object.defineProperty(globalCrypto, "subtle", {
    get() {
      return subtleCrypto;
    },
  });
}
export { Buffer };
