import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from '@databricks/appkit-ui/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { investigationSchema, type Investigation, type InvestigationSummary } from '../../../../shared/investigations';
import { formatDate, formatTime } from '../../lib/formatters';
import { investigationRequest, listSchema, readInvestigation } from './api';

const textAreaClass = 'min-h-24 w-full rounded-md border bg-background p-3 text-sm';

export function InvestigationsPage() {
  const { caseId } = useParams();
  return caseId ? <InvestigationDetail key={caseId} caseId={caseId} /> : <InvestigationList />;
}

function InvestigationList() {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const [records, setRecords] = useState<InvestigationSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    investigationRequest('/api/investigations', listSchema, { signal: abort.signal })
      .then((result) => setRecords(result.investigations))
      .catch((cause: unknown) => {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Investigations could not be loaded.');
      });
    return () => abort.abort();
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const record = await investigationRequest('/api/investigations', investigationSchema, {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), question: question.trim() }),
      });
      dialog.current?.close();
      await navigate(`/cases/${record.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Investigation could not be created.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary">FROM CONVERSATION TO CHANGE</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Investigations</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Collect call evidence, test your explanation, and share a finding with its sources.
          </p>
        </div>
        <Button onClick={() => dialog.current?.showModal()}>+ New investigation</Button>
      </div>
      <p className="rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground">
        Server-backed cases · named-user read-only sharing · source permissions checked when evidence is opened or
        exported. Showing up to 200 accessible investigations.
      </p>
      {error ? <ErrorMessage title="Investigations unavailable" message={error} /> : null}
      {!records && !error ? (
        <Skeleton className="h-64 w-full" />
      ) : records?.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {records.map((record) => (
            <Card key={record.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline">{record.shared ? 'Shared with you' : 'Your investigation'}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(record.updatedAt)}</span>
                </div>
                <CardTitle className="pt-3">
                  <Link to={`/cases/${record.id}`} className="hover:text-primary">
                    {record.title}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                  {record.question || 'An open question, ready for evidence.'}
                </p>
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">
                    {record.excerptCount} excerpts · {record.noteCount} notes
                  </span>
                  <Link className="font-medium text-primary" to={`/cases/${record.id}`}>
                    Open investigation →
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : records ? (
        <Card>
          <CardContent className="p-10 text-center">
            <h3 className="font-semibold">Start with a question</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Create an investigation, then save relevant moments from Explore. Keep your hypothesis and counterexamples
              alongside the source conversations.
            </p>
            <Button variant="outline" className="mt-5" onClick={() => dialog.current?.showModal()}>
              Create your first investigation
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <dialog
        ref={dialog}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/70"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form className="space-y-4" onSubmit={(event) => void create(event)}>
          <h3 className="text-xl font-semibold">Start an investigation</h3>
          {error ? <ErrorMessage title="Could not create investigation" message={error} /> : null}
          <label className="block space-y-2 text-sm">
            <span>Title</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={160}
              placeholder="What are you looking into?"
              autoFocus
            />
          </label>
          <label className="block space-y-2 text-sm">
            <span>Question or hypothesis</span>
            <textarea
              className={textAreaClass}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={4000}
              placeholder="What pattern do you expect, and what evidence would challenge it?"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? 'Creating…' : 'Create investigation'}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function InvestigationDetail({ caseId }: { caseId: string }) {
  const [record, setRecord] = useState<Investigation | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const [emails, setEmails] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    readInvestigation(caseId, abort.signal)
      .then((result) => {
        setRecord(result);
        setTitle(result.title);
        setQuestion(result.question);
        setEmails(result.sharedWith.join('\n'));
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Investigation could not be loaded.');
      });
    return () => abort.abort();
  }, [caseId]);
  async function mutate(path: string, body: unknown, method = 'POST') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await investigationRequest(`/api/investigations/${caseId}${path}`, investigationSchema, {
        method,
        body: JSON.stringify(body),
      });
      setRecord(result);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The change could not be saved.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (!record)
    return error ? (
      <div className="space-y-4">
        <Link className="text-sm text-primary" to="/cases">
          ← Investigations
        </Link>
        <ErrorMessage title="Investigation unavailable" message={error} />
        <p className="text-sm text-muted-foreground">
          The case may not be shared with you, or its source evidence may no longer be accessible. Source access is
          required even when a case is shared.
        </p>
      </div>
    ) : (
      <Skeleton className="h-[600px] w-full" />
    );
  const clips = record.items.filter((item) => item.type === 'clip');
  const notes = record.items.filter((item) => item.type === 'note');
  return (
    <div className="space-y-6">
      <Link className="text-sm text-primary" to="/cases">
        ← All investigations
      </Link>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest text-primary">EVIDENCE WORKSPACE</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">{record.title}</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {record.ownerEmail} · updated {formatDate(record.updatedAt)} · version {record.version}
            {record.canEdit ? '' : ' · read only'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard
                .writeText(window.location.href)
                .then(() => setMessage('Investigation link copied. Viewers still need case and source access.'))
                .catch(() => setMessage('Clipboard unavailable. Copy the URL from your browser.'));
            }}
          >
            Copy link
          </Button>
          <Button asChild>
            <a href={`/api/investigations/${caseId}/brief`}>Export brief ↗</a>
          </Button>
        </div>
      </div>
      {error ? <ErrorMessage title="Change not saved" message={error} /> : null}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Saved excerpts', clips.length],
          ['Conversations with evidence', new Set(clips.map((item) => item.interactionId)).size],
          ['Analyst notes', notes.length],
          ['Readers', record.sharedWith.length],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex justify-between gap-3">
              <CardTitle>Collected evidence</CardTitle>
              {record.canEdit ? (
                <Link className="text-sm text-primary" to="/explore">
                  + Find more calls
                </Link>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Excerpts are retrieved from currently authorized, masked source text.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {!clips.length ? (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                No excerpts yet.{' '}
                <Link className="text-primary" to="/explore">
                  Find a conversation
                </Link>{' '}
                and save evidence from its transcript.
              </div>
            ) : (
              clips.map((item, index) => (
                <article className="rounded-lg border bg-muted/20 p-4" key={item.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs tracking-wider text-muted-foreground">
                      EVIDENCE {String(index + 1).padStart(2, '0')}
                    </span>
                    <Badge variant="outline">{record.excerpts[item.id]?.queue}</Badge>
                  </div>
                  <h3 className="mt-3 text-sm font-medium">
                    <Link
                      className="text-primary"
                      to={`/calls/${encodeURIComponent(item.interactionId ?? '')}?${new URLSearchParams({ t: String(item.start ?? 0), from: `/cases/${caseId}` })}`}
                    >
                      {item.interactionId} · {formatTime(item.start ?? 0)}–{formatTime(item.end ?? 0)} ↗
                    </Link>
                  </h3>
                  <blockquote className="my-4 border-l-2 border-primary/50 pl-3 text-sm leading-relaxed">
                    “{record.excerpts[item.id]?.text}”
                  </blockquote>
                  <p className="text-sm">
                    <span className="text-xs font-medium text-muted-foreground">ANALYST NOTE</span>
                    <br />
                    {item.note}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {item.createdBy} · {formatDate(item.createdAt)}
                  </p>
                </article>
              ))
            )}
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Investigation question</CardTitle>
            </CardHeader>
            <CardContent>
              {record.canEdit ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate('', { title, question, version: record.version }, 'PATCH').then((result) => {
                      if (result) setMessage('Investigation details saved.');
                    });
                  }}
                >
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>Title</span>
                    <Input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} />
                  </label>
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>Question or hypothesis</span>
                    <textarea
                      className={textAreaClass}
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      maxLength={4000}
                    />
                  </label>
                  <Button size="sm" variant="outline" type="submit" disabled={busy || !title.trim()}>
                    Save details
                  </Button>
                </form>
              ) : (
                <p className="whitespace-pre-wrap text-sm">{record.question || 'No question added.'}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Analyst notebook</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {notes.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <p className="whitespace-pre-wrap text-sm">{item.note}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.createdBy} · {formatDate(item.createdAt)}
                  </p>
                </div>
              ))}
              {record.canEdit ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate('/items', { version: record.version, item: { type: 'note', note: note.trim() } }).then(
                      (result) => {
                        if (result) {
                          setNote('');
                          setMessage('Note added.');
                        }
                      }
                    );
                  }}
                >
                  <label className="block space-y-2 text-sm">
                    <span>Add a note or counterexample</span>
                    <textarea
                      className={textAreaClass}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      required
                      maxLength={4000}
                      placeholder="What does the evidence suggest?"
                    />
                  </label>
                  <Button variant="outline" size="sm" type="submit" disabled={busy || !note.trim()}>
                    Add note
                  </Button>
                </form>
              ) : !notes.length ? (
                <p className="text-sm text-muted-foreground">No analyst notes.</p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Named readers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Sharing grants read-only access to this case. It does not grant access to its source conversations or
                unredacted audio.
              </p>
              {record.canEdit ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate('/share', {
                      version: record.version,
                      emails: emails
                        .split(/[\n,;]+/)
                        .map((email) => email.trim())
                        .filter(Boolean),
                    }).then((result) => {
                      if (result) setMessage('Named readers updated. Share the case link with them.');
                    });
                  }}
                >
                  <label className="block space-y-2 text-sm">
                    <span>Email addresses, one per line</span>
                    <textarea
                      className={textAreaClass}
                      value={emails}
                      onChange={(event) => setEmails(event.target.value)}
                      placeholder="colleague@example.com"
                    />
                  </label>
                  <Button variant="outline" size="sm" type="submit" disabled={busy}>
                    Update readers
                  </Button>
                </form>
              ) : (
                <p className="break-words text-sm">{record.sharedWith.join(', ') || 'Only the owner'}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Selected evidence does not establish prevalence, causal impact, or financial savings. Verify AI annotations and
        compare with operational outcomes before making a recommendation.
      </p>
    </div>
  );
}

function ErrorMessage({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
