import type { Activity, Attempt, WorkspaceSnapshot } from '../shared/types';
import { evidenceStanding } from '../shared/reliability-state';
import { EvidenceCorrection } from './Reliability';
import { RichText } from './RichText';
import { SourceLinks } from './Materials';
import { Badge, Button, outcomeLabels, timeLabel } from './ui';

export function TaskFeedback({
  attempt,
  activity,
  snapshot,
  onSource,
  onContinue,
  busy,
}: {
  attempt: Attempt;
  activity: Activity;
  snapshot: WorkspaceSnapshot;
  onSource: (id: string) => void;
  onContinue: () => void;
  busy: boolean;
}) {
  const assessment = attempt.assessment;
  if (!assessment) return null;
  const evidence = snapshot.evidence.filter((item) => item.attemptId === attempt.id);
  const effective = evidence.find((item) => evidenceStanding(snapshot, item).effective);
  const needsReview =
    evidence.some((item) => item.status === 'needs_review') || (evidence.length > 0 && !effective);
  const completed = !!effective && !needsReview && assessment.outcome === 'met';
  const status = needsReview
    ? '尝试中 · 待复核'
    : !completed
      ? '尝试中'
      : effective.status === 'delayed'
        ? '经过回访 · 延迟重构'
        : effective.status === 'transfer'
          ? '经过回访 · 迁移应用'
          : effective.status === 'independent'
            ? '独立完成'
            : '有帮助完成';
  return (
    <section className="task-feedback" aria-label="本次反馈" data-attempt-id={attempt.id}>
      <div className="section-heading">
        <h3>本次反馈</h3>
        <Badge tone={completed ? 'green' : 'amber'}>{status}</Badge>
      </div>
      {evidence.map((item) => (
        <EvidenceCorrection key={item.id} snapshot={snapshot} evidence={item} />
      ))}
      <h4>这次要做到什么</h4>
      <p>{attempt.activitySnapshot?.title || activity.title}</p>
      <h4>做到了哪些，还差哪一步</h4>
      <RichText text={assessment.feedback} />
      <SourceLinks ids={assessment.sourceIds} snapshot={snapshot} onSource={onSource} />
      <details className="feedback-details">
        <summary>查看原答、逐项标准与依据</summary>
        <small>
          {timeLabel(attempt.submittedAt)} ·{' '}
          {attempt.helpLevel ? `帮助等级 ${attempt.helpLevel}` : '本题无直接提示'}
        </small>
        <RichText className="attempt-text" text={attempt.text} />
        {assessment.criteria.map((item, index) => (
          <div className="feedback-criterion" key={index}>
            <strong>{outcomeLabels[item.result]}</strong>
            <RichText text={item.criterion} />
            <RichText text={item.reason} />
          </div>
        ))}
        {assessment.limitations.length > 0 && (
          <div className="limitations">
            <strong>需要继续核对</strong>
            {assessment.limitations.map((text, index) => (
              <RichText key={index} text={text} />
            ))}
          </div>
        )}
      </details>
      <div className="feedback-next">
        <div>
          <h4>下一步</h4>
          <p>
            {needsReview
              ? '先在学习工具中查看核验与疑问，原答和反馈会保留。'
              : assessment.outcome === 'met'
                ? '继续尝试下一步，或在上方补充你的推理。'
                : '在上方补充缺少的步骤，再提交修订；也可以继续学习。'}
          </p>
        </div>
        <Button disabled={busy} onClick={onContinue}>
          按当前理解继续
        </Button>
      </div>
    </section>
  );
}
