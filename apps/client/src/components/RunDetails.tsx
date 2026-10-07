import type { AgentRun } from '../../../../packages/contracts/src/index';
import { Badge, Button, Dialog } from './ui';

export function RunDetails({
  run,
  onClose,
  onCancel,
  onSource,
}: {
  run: AgentRun;
  onClose: () => void;
  onCancel: () => void;
  onSource: (id: string) => void;
}) {
  const detail = run.inspection;
  const active = ['queued', 'running', 'retrying', 'cancelling'].includes(run.status);
  const date = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');
  return (
    <Dialog
      className="dialog--run-details"
      title="Run details"
      description="Only you can inspect this run."
      onClose={onClose}
    >
      <p>
        <Badge>{run.status}</Badge> · Agent version {run.agent_version} · {run.provider}
        {detail?.model ? ` / ${detail.model}` : ''}
      </p>
      {run.error && <p role="status">{run.error}</p>}
      {detail && (
        <>
          <p>
            Requested {date(detail.created_at)} · Finished {date(detail.finished_at)}
          </p>
          <p>Deadline {date(detail.deadline_at)}</p>
          {detail.cancellation_requested_at && (
            <p>
              Cancellation requested {date(detail.cancellation_requested_at)}.{' '}
              {run.status === 'cancelled'
                ? 'Execution authority has been revoked; provider billing may still include the interrupted call.'
                : 'Waiting for the worker to stop or its lease to expire.'}
            </p>
          )}
          <h3>Scope and limits</h3>
          <p>
            {detail.scope.mode} · {run.coverage?.selectedMessages} of {run.coverage?.totalMessages}{' '}
            messages · {run.coverage?.omittedMessages} omitted
          </p>
          <p>
            Context ceiling {detail.policy.maxContextTokens.toLocaleString()} tokens · Output
            ceiling {detail.policy.maxOutputTokens.toLocaleString()} · Maximum attempts{' '}
            {detail.policy.maxAttempts}
          </p>
          <p>
            Tokens charged or reserved: {detail.budgetTokens.toLocaleString()}. Unknown usage
            retains a conservative estimate.
          </p>
          <h3>Execution steps</h3>
          {detail.steps.length ? (
            <ol className="run-detail-steps">
              {detail.steps.map((s, i) => (
                <li key={i}>
                  <strong>{s.name}</strong> · {s.status}
                  {s.attempt ? ` · attempt ${s.attempt}` : ''}
                  <small>
                    {date(s.started_at)} → {date(s.finished_at)}
                  </small>
                  {s.error && <p>{s.error}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p>Waiting for a worker.</p>
          )}
          <h3>Attempts and usage</h3>
          {detail.attempts.map((attempt) => (
            <p key={attempt.number}>
              Attempt {attempt.number}: {attempt.status} ·{' '}
              {attempt.usage
                ? `${attempt.usage.status} usage; input ${attempt.usage.input ?? 'unknown'}, output ${attempt.usage.output ?? 'unknown'}, cache read ${attempt.usage.cacheRead ?? 'unknown'}, cache write ${attempt.usage.cacheWrite ?? 'unknown'}`
                : 'No model call started'}
              {attempt.error ? ` · ${attempt.error}` : ''}
            </p>
          ))}
          <h3>Selected sources</h3>
          <div className="run-detail-sources">
            {detail.sources.map((source, i) => (
              <Button
                key={source.id}
                size="sm"
                onClick={() => {
                  onClose();
                  onSource(source.id);
                }}
              >
                Message {i + 1} · revision {source.revision}
              </Button>
            ))}
          </div>
        </>
      )}
      {run.result && (
        <>
          <h3>Private result</h3>
          <p className="message__body">{run.result.body}</p>
          <p>{run.result.shared_message_id ? 'Posted to conversation' : 'Private; not posted'}</p>
        </>
      )}
      {active && (
        <Button variant="danger" disabled={run.status === 'cancelling'} onClick={onCancel}>
          {run.status === 'cancelling' ? 'Stopping…' : 'Stop run'}
        </Button>
      )}
    </Dialog>
  );
}
