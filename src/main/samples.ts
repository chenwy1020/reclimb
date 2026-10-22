import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LearningStore } from './store';
import type { Activity, Session } from '../shared/types';
const specs = [
  {
    id: 'sample-reasoning',
    title: '从现象到函数',
    goal: '在新情境中识别输入与输出关系，解释模型成立的条件。',
    cap: '识别线性关系及其边界',
    kind: 'prediction',
    text: '# 从现象到函数\n\n这是一份重登内置的原创练习材料，不是引用的出版教材。\n\n当每增加一个单位的输入，输出总增加同样的数量时，可以尝试用 y=ax+b 表示关系。其中 a 表示输入增加一单位时的输出变化，b 表示输入为零时的输出。\n\n例如：一辆出租车在固定起步价之上，每公里另收固定费用。模型能否使用取决于条件：是否存在免费里程、分段计费、夜间加价。选择模型前，要先检验这些条件。\n\n“两个量一起增加”不足以证明线性关系。边长为 x 的正方形面积是 x²，边长每增加一单位时，面积增加量并不固定。',
    instruction:
      '一个储水箱最初有12升水，每分钟匀速加入3升。\n1. 预测4分钟后的水量，并写下你的关系式。\n2. 说明这个关系式成立需要哪些条件。\n3. 如果水箱最多能装20升，原关系式从什么时候开始不能继续直接描述箱内水量？',
    rubric: ['正确表达初始量与恒定变化率', '说明模型依赖的实际条件', '识别容量上限导致的适用边界'],
    answer:
      '参考思路：未满时 V(t)=12+3t。没有容量限制时4分钟为24升；容量为20升时，在t=8/3分钟达到上限，此后箱内水量不能继续按直线无限增长。条件包括进水速率恒定、没有漏水或排水，以及明确时间起点。实际水箱4分钟时最多20升。',
    sourceTitle: '原创材料 · 线性关系',
  },
  {
    id: 'sample-argument',
    title: '把观点变成可检验的论证',
    goal: '独立区分结论、证据与隐含前提，能修订一个过强的主张。',
    cap: '辨认论证的缺口并修订',
    kind: 'argument',
    text: '# 把观点变成可检验的论证\n\n这是一份重登内置的原创练习材料，不是引用的出版教材。\n\n一个论证通常由主张、证据，以及把证据连接到主张的理由组成。理解一句话说了什么，还不足以判断它为什么值得相信。\n\n例如：某班引入讨论课后平均分上升，不能仅凭这个先后关系断言讨论课造成了进步。可能同时发生了试卷变简单、学生额外补习，或者参与测验的人发生变化。\n\n合理修订不是一概否定已有证据，而是把主张的强度调整到证据支持的范围，并说明下一步需要什么比较或观察。\n\n反例帮助识别一项结论的边界；更可靠的比较应尽可能控制与所检验因素无关的差异。',
    instruction:
      '读下面的说法：\n“我们读书群的十个人开始使用电子笔记后，都觉得自己记得更牢，所以电子笔记比纸笔更能提升所有人的长期记忆。”\n\n请写出其主张、已有证据和至少两个尚未检查的前提；把原说法改写成与证据强度相符的版本，并提出一次更有说服力的检验。',
    rubric: [
      '区分主张与自我感受证据',
      '指出抽样与长期表现验证的缺口',
      '修订主张并提出可执行的比较',
    ],
    answer:
      '参考思路：证据只是十名参与者的主观感受，尚未直接测量延迟记忆，也没有纸笔对照，样本可能有选择偏差。可修订为“本群十名成员报告电子笔记带来更强的记忆感，是否改善长期保持仍需比较验证”。可在相近材料和学习时间下比较两种记录方式，延迟一段时间后做相同标准的无笔记测验，并记录其他差异。',
    sourceTitle: '原创材料 · 论证结构',
  },
] as const;
export function seedSamples(store: LearningStore): void {
  const dataDir = store.snapshot().dataDirectory,
    now = new Date().toISOString();
  store.transaction(() => {
    for (const spec of specs) {
      if (store.get('projects', spec.id)) continue;
      const mid = spec.id + '-material',
        fid = spec.id + '-fragment',
        cid = spec.id + '-capability',
        sid = spec.id + '-session';
      const dir = join(dataDir, 'materials', mid);
      mkdirSync(dir, { recursive: true });
      const originalName = spec.id + '.md',
        storedPath = join(dir, originalName);
      writeFileSync(storedPath, spec.text, 'utf8');
      store.put('projects', {
        id: spec.id,
        title: spec.title,
        goal: spec.goal,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        routeSummary:
          '这是可离线阅读和作答的原创练习示例。连接AI后可以获得针对作答的反馈、生成不同情境并继续扩展路线。',
      });
      store.put('materials', {
        id: mid,
        projectId: spec.id,
        title: spec.sourceTitle,
        kind: 'markdown',
        originalName,
        storedPath,
        importedAt: now,
        warnings: ['内置原创练习，用于了解使用流程；不是出版教材或已验证的教学效果。'],
        fragmentCount: 1,
        summary: spec.text.slice(0, 180),
      });
      store.put('fragments', {
        id: fid,
        projectId: spec.id,
        materialId: mid,
        locator: '原创材料 · 全文',
        text: spec.text,
        ordinal: 0,
      });
      store.put('capabilities', {
        id: cid,
        projectId: spec.id,
        title: spec.cap,
        description: spec.goal,
        prerequisites: [],
        sourceIds: [fid],
        order: 0,
      });
      const activity: Activity = {
        title: spec.cap,
        instruction: spec.instruction,
        kind: spec.kind,
        rubric: [...spec.rubric],
        sourceIds: [fid],
        referenceAnswer: spec.answer,
        assessmentBasis: 'source',
      };
      const session: Session = {
        id: sid,
        projectId: spec.id,
        capabilityId: cid,
        activity,
        mode: 'practice',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        draft: '',
        helpLevel: 0,
        helpEvents: [],
        messages: [
          {
            id: sid + '-intro',
            role: 'system',
            text: '内置原创练习。你可以先阅读和尝试；AI反馈需要在设置中连接自己的服务。完整示范可离线查看，查看后本次会记录帮助。',
            createdAt: now,
          },
        ],
        checkpoint: '从一个自己的判断开始',
        nextStep: '阅读原文后写下第一次尝试',
      };
      store.put('sessions', session);
    }
  });
}
