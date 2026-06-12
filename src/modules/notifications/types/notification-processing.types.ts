export type NotificationProcessingResult =
  | {
      status: 'created';
      notificationId: string;
      recipientCount: number;
    }
  | {
      status: 'duplicate';
      notificationId: string;
      recipientCount: number;
    }
  | {
      status: 'skipped';
      reason: 'no_recipients';
      recipientCount: 0;
    };
