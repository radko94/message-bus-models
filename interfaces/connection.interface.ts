import { Socket } from "net";

export interface IConnection {
  _id: string;
  socket: Socket;
}
