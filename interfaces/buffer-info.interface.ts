export interface IBufferInfo {
  fin: boolean;
  masked: boolean;
  opcode: number;
  payloadLength: number;
  nextData: Buffer;
  fragmented: number;
}
