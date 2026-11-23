import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { Button } from './Button';

/**
 * The "shown only once" invite link panel: Copy, Share, Done. The token lives in the caller's state only
 * (never a store or browser storage); `onDone` is the caller's cue to drop it.
 */
export function InviteLink({
  email,
  url,
  onDone,
}: {
  email: string;
  url: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // A link made from a row far down a list appears away from the tap: bring it into view (no animation).
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div ref={panel} role="status" className="mt-4 space-y-2 rounded-card bg-surface-2 p-3">
      <p className="wrap-anywhere text-sm font-semibold">
        Link for {email}. It is shown only once.
      </p>
      <p className="break-all text-caption text-muted">{url}</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={copy}>
          {copied ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {typeof navigator.share === 'function' && (
          <Button
            variant="secondary"
            onClick={() => navigator.share({ url }).catch(() => undefined)}
          >
            <Share2 className="h-4 w-4" aria-hidden /> Share
          </Button>
        )}
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
