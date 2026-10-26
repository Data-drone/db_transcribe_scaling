import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@databricks/appkit-ui/react';
import { queues, type Cohort } from '../../lib/cohort';

export function CohortControls({
  cohort,
  onChange,
  prefix,
}: {
  cohort: Cohort;
  onChange: (patch: Partial<Cohort>) => void;
  prefix: string;
}) {
  return (
    <div className="ci-scope-controls grid gap-3 sm:grid-cols-3">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`${prefix}-queue`}>
          Queue
        </label>
        <Select value={cohort.queue} onValueChange={(queue) => onChange({ queue })}>
          <SelectTrigger id={`${prefix}-queue`} aria-label="Queue">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All queues</SelectItem>
            {queues.map((queue) => (
              <SelectItem key={queue} value={queue}>
                {queue}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`${prefix}-start`}>
          From · UTC
        </label>
        <Input
          id={`${prefix}-start`}
          aria-label="From date in UTC"
          type="date"
          value={cohort.start}
          max={cohort.end || undefined}
          onChange={(event) => onChange({ start: event.target.value })}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`${prefix}-end`}>
          To · UTC
        </label>
        <Input
          id={`${prefix}-end`}
          aria-label="To date in UTC"
          type="date"
          value={cohort.end}
          min={cohort.start || undefined}
          onChange={(event) => onChange({ end: event.target.value })}
        />
      </div>
    </div>
  );
}
