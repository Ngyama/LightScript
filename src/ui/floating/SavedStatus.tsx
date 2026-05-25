interface SavedStatusProps {
  text: string;
}

export function SavedStatus({ text }: SavedStatusProps) {
  if (!text) return null;
  return <div className="saved-status">{text}</div>;
}
