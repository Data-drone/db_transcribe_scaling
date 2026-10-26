import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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
  useGenieChat,
} from '@databricks/appkit-ui/react';
import type { GenieMessageItem } from '@databricks/appkit-ui/react';
import { Sparkles } from 'lucide-react';
import { useWorkspaceIdentity } from '../../components/workspace/WorkspaceIdentity';

const questions = [
  'How many calls are available in each queue, and which recording dates do they cover?',
  'Which contact reasons have the longest average call duration? Show enrichment coverage.',
  'Show five calls with negative closing sentiment and their interaction IDs.',
  'Which calls mention repeat contact? Include the interaction IDs so I can review the evidence.',
];
export function AskPage() {
  const [params] = useSearchParams();
  const [question, setQuestion] = useState(params.get('q') ?? '');
  const identity = useWorkspaceIdentity();
  const { messages, status, error, sendMessage, reset } = useGenieChat({ alias: 'default' });
  const busy = status === 'streaming' || status === 'loading-history';
  function ask(text: string) {
    if (!text.trim() || busy) return;
    sendMessage(text.trim());
    setQuestion('');
  }
  return (
    <section className="space-y-6">
      <div className="ci-page-heading">
        <div>
          <span className="ci-eyebrow">INTELLIGENCE / ASK</span>
          <h1>Ask your conversations</h1>
          <p>Explore governed call data. Follow an answer back to its sources.</p>
        </div>
        <Button variant="outline" onClick={reset}>
          New conversation
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Badge variant="outline">{identity.email ?? identity.user ?? 'Authenticated user'}</Badge>
        <span>Genie queries use your Databricks permissions.</span>
      </div>
      {!messages.length && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles size={18} /> Start with a question
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {questions.map((text) => (
              <Button
                key={text}
                variant="outline"
                className="h-auto whitespace-normal justify-start py-4 text-left font-normal"
                disabled={busy}
                onClick={() => ask(text)}
              >
                {text}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="space-y-5" aria-live="polite">
        {messages.map((message) => (
          <Answer key={message.id} message={message} />
        ))}
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {status === 'loading-history' ? 'Loading conversation…' : 'Genie is analyzing data and executing its query…'}
        </p>
      )}
      {status === 'error' && (
        <Alert variant="destructive">
          <AlertTitle>Genie could not complete this question</AlertTitle>
          <AlertDescription>{error ?? 'Try rephrasing the question or starting a new conversation.'}</AlertDescription>
        </Alert>
      )}
      <form
        className="flex gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <Input
          aria-label="Ask about call data"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about queues, patterns, sentiment or individual calls…"
        />
        <Button type="submit" disabled={busy || !question.trim()}>
          Ask <Sparkles size={15} />
        </Button>
      </form>
      <p className="ci-scope-note">
        AI-generated from call data. Review the SQL, enrichment coverage and linked conversations before drawing a
        conclusion. Repeat-contact mentions are not measured repeat-contact outcomes.
      </p>
    </section>
  );
}
function Answer({ message }: { message: GenieMessageItem }) {
  if (message.role === 'user')
    return <div className="rounded-lg border border-border bg-secondary p-4 text-sm">{message.content}</div>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Genie answer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {message.content && <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>}
        {message.error && (
          <Alert variant="destructive">
            <AlertDescription>{message.error}</AlertDescription>
          </Alert>
        )}
        {message.attachments.map((attachment, index) => (
          <div key={attachment.attachmentId ?? index} className="space-y-4">
            {attachment.text?.content && attachment.text.content !== message.content && (
              <p className="whitespace-pre-wrap text-sm leading-7">{attachment.text.content}</p>
            )}
            {attachment.query && (
              <details className="rounded-md border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Generated SQL · {attachment.query.title ?? 'How this answer was computed'}
                </summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre text-xs leading-6">
                  {attachment.query.query ?? 'SQL not supplied by Genie.'}
                </pre>
              </details>
            )}
            {attachment.suggestedQuestions?.map((text) => (
              <p key={text} className="text-xs text-muted-foreground">
                Suggested follow-up: {text}
              </p>
            ))}
          </div>
        ))}
        {[...message.queryResults.entries()].map(([id, result]) => {
          const columns = result.manifest?.schema?.columns ?? [];
          const rows = result.result?.data_array ?? [];
          const timestampColumn = columns.findIndex((column) =>
            ['start_seconds', 'evidence_start_seconds'].includes(column.name.toLowerCase())
          );
          return (
            <div key={id} className="space-y-2">
              {!rows.length ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No rows matched this question. Try a different period or queue.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {columns.map((column) => (
                          <th key={column.name} className="border-b p-3 text-left text-xs text-muted-foreground">
                            {column.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 100).map((row, index) => (
                        <tr key={index}>
                          {row.map((cell, column) => (
                            <td key={column} className="border-b border-border p-3">
                              {columns[column]?.name.toLowerCase() === 'interaction_id' && cell ? (
                                <Link
                                  className="text-primary underline underline-offset-4"
                                  to={`/calls/${encodeURIComponent(cell)}?from=${encodeURIComponent('/ask')}${
                                    timestampColumn >= 0 &&
                                    row[timestampColumn] != null &&
                                    Number.isFinite(Number(row[timestampColumn])) &&
                                    Number(row[timestampColumn]) >= 0
                                      ? `&t=${Number(row[timestampColumn])}`
                                      : ''
                                  }`}
                                >
                                  {cell}
                                </Link>
                              ) : (
                                (cell ?? '—')
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {rows.length > 100 && (
                <p className="text-xs text-muted-foreground">Showing the first 100 of {rows.length} returned rows.</p>
              )}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">AI-generated — verify the SQL and source conversations.</p>
      </CardContent>
    </Card>
  );
}
