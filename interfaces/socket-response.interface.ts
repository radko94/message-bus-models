import { Socket } from "net";
import { IncomingMessage } from "http";

export interface ISocketResponse {
  data: [IncomingMessage, Socket];
}
