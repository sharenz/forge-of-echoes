interface GameNotificationProps {
  message: string;
}

export function GameNotification({ message }: GameNotificationProps) {
  return (
    <div className="game-notification" role="status" aria-live="polite">
      <span className="game-notification-mark" aria-hidden="true">◆</span>
      <span>{message}</span>
    </div>
  );
}
