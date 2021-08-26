import {
  IBufferInfo,
  IConsumedDataStep,
  IMaskStep,
  IPayloadStep,
} from "@interfaces/*";

export class BufferHandler {
  private _bufferedBytes: number;
  private _totalPayloadLength: number;
  private _maxPayload: number;
  private _messageLength: number;
  private _fragments: Array<Buffer>;

  constructor(maxPayload: number) {
    this._maxPayload = maxPayload;
    this._fragments = [];
    this._bufferedBytes = 0;
  }

  public decode(buffer: Buffer): Buffer {
    this._bufferedBytes += buffer.length;

    const info = this._getInfo(buffer);

    let nextData = info.nextData;
    let payloadLength = info.payloadLength;

    if (payloadLength === 126) {
      const result = this._getPayloadLength16(nextData, info.opcode);

      nextData = result.nextBuffer;
      payloadLength = result.payloadLength;
    } else if (payloadLength === 127) {
      const result = this._getPayloadLength64(nextData, info.opcode);

      nextData = result.nextBuffer;
      payloadLength = result.payloadLength;
    }

    const mask = this._getMask(nextData);

    return this._getData(
      mask.nextBuffer,
      payloadLength,
      info.masked,
      mask.mask,
      info.opcode,
      info.fin
    );
  }

  public encode(message: Buffer): Buffer[] {
    // const merge = options.mask && options.readOnly;
    // let offset = options.mask ? 6 : 2;

    if (!message) return;

    let offset = 2;
    let payloadLength = message.length;

    if (message.length >= 65536) {
      offset += 8;
      payloadLength = 127;
    } else if (message.length > 125) {
      offset += 2;
      payloadLength = 126;
    }

    // const target = Buffer.allocUnsafe(merge ? data.length + offset : offset);
    const target = Buffer.allocUnsafe(offset);

    target[0] = 1 | 0x80;
    // if (options.rsv1) target[0] |= 0x40;

    target[1] = payloadLength;

    if (payloadLength === 126) {
      target.writeUInt16BE(message.length, 2);
    } else if (payloadLength === 127) {
      target.writeUInt32BE(0, 2);
      target.writeUInt32BE(message.length, 6);
    }

    return [target, message];
    // if (!options.mask) return [target, data];

    // randomFillSync(mask, 0, 4);

    // target[1] |= 0x80;
    // target[offset - 4] = mask[0];
    // target[offset - 3] = mask[1];
    // target[offset - 2] = mask[2];
    // target[offset - 1] = mask[3];

    // if (merge) {
    //   applyMask(data, mask, target, offset, data.length);
    //   return [target];
    // }

    // applyMask(data, mask, data, 0, data.length);
    // return [target, data];
  }

  private _getInfo(data: Buffer): IBufferInfo {
    if (this._bufferedBytes < 2) {
      return;
    }

    const { consumedData, nextBuffer } = this._consume(2, data);

    if ((consumedData[0] & 0x30) !== 0x00) this._throwError("RSV2 and RSV3");

    const compressed = (consumedData[0] & 0x40) === 0x40;

    const fin = (consumedData[0] & 0x80) === 0x80;
    let opcode = consumedData[0] & 0x0f;

    const payloadLength = consumedData[1] & 0x7f;

    let fragmented = 0;

    if (opcode === 0x00) {
      if (compressed) this._throwError("RSV1 must be clear");
      if (!fragmented) this._throwError("invalid opcode 0");

      opcode = fragmented;
    } else if (opcode === 0x01 || opcode === 0x02) {
      if (fragmented) this._throwError(`invalid opcode ${opcode}`);
    } else if (opcode > 0x07 && opcode < 0x0b) {
      if (!fin) this._throwError("FIN must be set");
      if (compressed) this._throwError("RSV1 must be clear");
      if (payloadLength > 0x7d)
        this._throwError(`invalid payload length ${payloadLength}`);
    } else {
      this._throwError(`invalid opcode unmask ${opcode}`);
    }

    if (!fin && !fragmented) fragmented = opcode;
    const masked = (consumedData[1] & 0x80) === 0x80;

    this._checkLength(payloadLength, opcode);

    return {
      fin,
      masked,
      opcode,
      payloadLength,
      nextData: nextBuffer,
      fragmented,
    };
  }

  private _getMask(data: Buffer): IMaskStep {
    if (this._bufferedBytes < 4) {
      return;
    }

    const { consumedData, nextBuffer } = this._consume(4, data);

    return {
      mask: consumedData,
      nextBuffer: nextBuffer,
    };
  }

  private _getData(
    data: Buffer,
    payloadLength: number,
    masked: boolean,
    mask: Buffer,
    opcode: number,
    fin: boolean
  ): Buffer {
    let _data = Buffer.alloc(0);

    if (payloadLength) {
      if (this._bufferedBytes < payloadLength) {
        return;
      }

      const { consumedData } = this._consume(payloadLength, data);
      _data = consumedData;
      if (masked) this._unmaskFn(_data, mask);
    }

    if (opcode > 0x07) return;

    if (_data.length) {
      this._messageLength = this._totalPayloadLength;
      this._fragments.push(_data);
    }

    return this._dataMessage(fin);
  }

  private _consume(numberOfBytes: number, buffer: Buffer): IConsumedDataStep {
    this._bufferedBytes -= numberOfBytes;

    if (numberOfBytes === buffer.length)
      return { consumedData: buffer, nextBuffer: null };

    if (numberOfBytes < buffer.length) {
      const bufferCopy = buffer;

      return {
        consumedData: bufferCopy.slice(0, numberOfBytes),
        nextBuffer: bufferCopy.slice(numberOfBytes),
      };
    }

    const consumedBuffer = Buffer.allocUnsafe(numberOfBytes);

    do {
      const bufferCopy = buffer;
      const offset = consumedBuffer.length - numberOfBytes;

      if (numberOfBytes >= bufferCopy.length) {
        consumedBuffer.set(buffer, offset);
      } else {
        consumedBuffer.set(
          new Uint8Array(
            bufferCopy.buffer,
            bufferCopy.byteOffset,
            numberOfBytes
          ),
          offset
        );
        buffer = bufferCopy.slice(numberOfBytes);
      }

      numberOfBytes -= bufferCopy.length;
    } while (numberOfBytes > 0);

    return { consumedData: consumedBuffer, nextBuffer: buffer };
  }

  private _checkLength(payloadLength: number, opcode: number): void {
    if (payloadLength && opcode < 0x08) {
      this._totalPayloadLength += payloadLength;
      if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0)
        this._throwError("Max payload size exceeded");
    }
  }

  private _unmaskFn(buffer: Buffer, mask: Buffer): void {
    const length = buffer.length;
    for (let i = 0; i < length; i++) {
      buffer[i] ^= mask[i & 3];
    }
  }

  private _dataMessage(fin: boolean): Buffer {
    if (fin) {
      const messageLength = this._messageLength;
      const fragments = this._fragments;

      this._totalPayloadLength = 0;
      this._messageLength = 0;
      this._fragments = [];

      const messageBuffer = this._concat(fragments, messageLength);

      if (!this._isValidUTF8(messageBuffer))
        this._throwError("invalid UTF-8 sequence");

      return messageBuffer;
    }
  }

  private _getPayloadLength16(data: Buffer, opcode: number): IPayloadStep {
    if (this._bufferedBytes < 2) {
      return;
    }

    const consumedData = this._consume(2, data);

    const payloadLength = consumedData.consumedData.readUInt16BE(0);
    const nextBuffer = consumedData.nextBuffer;

    this._checkLength(payloadLength, opcode);

    return {
      payloadLength,
      nextBuffer,
    };
  }

  private _getPayloadLength64(data: Buffer, opcode: number): IPayloadStep {
    if (this._bufferedBytes < 8) {
      return;
    }

    const consumedBuffer = this._consume(8, data);
    const frame = consumedBuffer.consumedData.readUInt32BE(0);

    if (frame > Math.pow(2, 53 - 32) - 1)
      this._throwError(
        "Unsupported WebSocket frame: payload length > 2^53 - 1"
      );

    const payloadLength = consumedBuffer.consumedData.readUInt32BE(4);
    const nextBuffer = consumedBuffer.nextBuffer;

    this._checkLength(payloadLength, opcode);

    return {
      payloadLength,
      nextBuffer,
    };
  }

  private _isValidUTF8(buffer: Buffer): boolean {
    const len = buffer.length;
    let i = 0;

    while (i < len) {
      if ((buffer[i] & 0x80) === 0) {
        // 0xxxxxxx
        i++;
      } else if ((buffer[i] & 0xe0) === 0xc0) {
        // 110xxxxx 10xxxxxx
        if (
          i + 1 === len ||
          (buffer[i + 1] & 0xc0) !== 0x80 ||
          (buffer[i] & 0xfe) === 0xc0 // Overlong
        ) {
          return false;
        }

        i += 2;
      } else if ((buffer[i] & 0xf0) === 0xe0) {
        // 1110xxxx 10xxxxxx 10xxxxxx
        if (
          i + 2 >= len ||
          (buffer[i + 1] & 0xc0) !== 0x80 ||
          (buffer[i + 2] & 0xc0) !== 0x80 ||
          (buffer[i] === 0xe0 && (buffer[i + 1] & 0xe0) === 0x80) || // Overlong
          (buffer[i] === 0xed && (buffer[i + 1] & 0xe0) === 0xa0) // Surrogate (U+D800 - U+DFFF)
        ) {
          return false;
        }

        i += 3;
      } else if ((buffer[i] & 0xf8) === 0xf0) {
        // 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
        if (
          i + 3 >= len ||
          (buffer[i + 1] & 0xc0) !== 0x80 ||
          (buffer[i + 2] & 0xc0) !== 0x80 ||
          (buffer[i + 3] & 0xc0) !== 0x80 ||
          (buffer[i] === 0xf0 && (buffer[i + 1] & 0xf0) === 0x80) || // Overlong
          (buffer[i] === 0xf4 && buffer[i + 1] > 0x8f) ||
          buffer[i] > 0xf4 // > U+10FFFF
        ) {
          return false;
        }

        i += 4;
      } else {
        return false;
      }
    }

    return true;
  }

  private _concat(list: Buffer[], totalLength: number): Buffer {
    if (list.length === 0) return Buffer.alloc(0);
    if (list.length === 1) return list[0];

    const target = Buffer.allocUnsafe(totalLength);
    let offset = 0;

    for (let i = 0; i < list.length; i++) {
      const buf = list[i];
      target.set(buf, offset);
      offset += buf.length;
    }

    if (offset < totalLength) return target.slice(0, offset);

    return target;
  }

  private _throwError(message: string): void {
    throw new Error(message);
  }
}
