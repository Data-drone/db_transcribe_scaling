import { Alert, AlertDescription, AlertTitle, Button, Input, Skeleton } from '@databricks/appkit-ui/react';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { investigationSchema, type InvestigationSummary } from '../../../../shared/investigations';
import { formatTime } from '../../lib/formatters';
import { investigationRequest, listSchema, readInvestigation } from './api';

export function EvidenceSaveDialog({
  interactionId,
  start,
  end,
  excerpt,
  onSaved,
}: {
  interactionId: string;
  start: number;
  end: number;
  excerpt: string;
  onSaved?: (caseId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [cases, setCases] = useState<InvestigationSummary[]>([]);
  const [caseId, setCaseId] = useState('new');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    setError('');
    setLoading(true);
    setNote('');
    dialog.current?.showModal();
    try {
      const result = await investigationRequest('/api/investigations', listSchema);
      const editable = result.investigations.filter((item) => !item.shared);
      setCases(editable);
      setCaseId(editable[0]?.id ?? 'new');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Investigations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const target =
        caseId === 'new'
          ? await investigationRequest('/api/investigations', investigationSchema, {
              method: 'POST',
              body: JSON.stringify({ title: title.trim() }),
            })
          : await readInvestigation(caseId);
      await investigationRequest(`/api/investigations/${target.id}/items`, investigationSchema, {
        method: 'POST',
        body: JSON.stringify({
          version: target.version,
          item: { type: 'clip', interactionId, start, end, note: note.trim() },
        }),
      });
      dialog.current?.close();
      if (onSaved) onSaved(target.id);
      else await navigate(`/cases/${target.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evidence could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button onClick={() => void open()} disabled={!Number.isFinite(start) || !Number.isFinite(end) || end <= start}>
        Save evidence
      </Button>
      <dialog
        ref={dialog}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/70"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <div>
            <p className="text-xs font-medium tracking-widest text-primary">BUILD AN INVESTIGATION</p>
            <h3 className="mt-2 text-xl font-semibold">Save conversation evidence</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {interactionId} · {formatTime(start)}–{formatTime(end)}
            </p>
          </div>
          <blockquote className="max-h-36 overflow-auto rounded-lg border-l-2 border-primary bg-muted/40 p-3 text-sm">
            {excerpt || 'The server will retrieve the masked source excerpt for this range.'}
          </blockquote>
          <p className="text-xs text-muted-foreground">
            The server verifies your source access and saves the full masked transcript turns overlapping this range.
            Original audio remains subject to each viewer’s permissions.
          </p>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Evidence not saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <label className="block space-y-2 text-sm">
                <span>Investigation</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3"
                  value={caseId}
                  onChange={(event) => setCaseId(event.target.value)}
                  disabled={busy}
                >
                  {cases.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                  <option value="new">+ Create a new investigation</option>
                </select>
              </label>
              {caseId === 'new' ? (
                <label className="block space-y-2 text-sm">
                  <span>Investigation title</span>
                  <Input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    maxLength={160}
                    placeholder="What are you investigating?"
                    disabled={busy}
                  />
                </label>
              ) : null}
              <label className="block space-y-2 text-sm">
                <span>Analyst note</span>
                <textarea
                  className="min-h-24 w-full rounded-md border bg-background p-3"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  required
                  maxLength={4000}
                  placeholder="What does this excerpt support, and what remains uncertain?"
                  disabled={busy}
                />
              </label>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" disabled={busy} onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || loading || !note.trim() || (caseId === 'new' && !title.trim())}>
              {busy ? 'Saving…' : 'Save to investigation'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
