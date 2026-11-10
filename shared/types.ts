export type User = { id: string; name: string; role: string; color: string };
export type Chat = { id: string; name: string; members: string[]; group: boolean };
export type Message = { id: string; chatId: string; senderId: string; text: string; createdAt: string };
export type Signal = { type: 'offer' | 'answer' | 'ice' | 'hangup' | 'decline'; to: string; from?: string; data?: any; video?: boolean };
