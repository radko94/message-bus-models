import { Socket } from "net";

export interface IConnection {
    id: string, 
    socket: Socket
}