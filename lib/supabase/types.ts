export type Message = {
  id: string;
  nickname: string;
  content: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      messages: {
        Row: Message;
        Insert: {
          id?: string;
          nickname: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          nickname?: string;
          content?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
