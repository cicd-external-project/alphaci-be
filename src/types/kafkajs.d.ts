declare module 'kafkajs' {
  export enum logLevel {
    ERROR = 0,
  }

  export interface Producer {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    send(payload: {
      topic: string;
      messages: Array<{ key?: string; value: string }>;
    }): Promise<unknown>;
  }

  export class Kafka {
    constructor(config: {
      clientId: string;
      brokers: string[];
      logLevel?: logLevel;
      ssl?: boolean;
      sasl?: {
        mechanism: 'plain';
        username: string;
        password: string;
      } | undefined;
    });

    producer(config?: { idempotent?: boolean }): Producer;
  }
}
