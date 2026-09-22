#!/usr/bin/env node
/**
 * check-think-strip.mjs —— 「思考段混进正文」剥离的验收（无头）。
 *
 * 守的是什么：`src/think-strip.ts`。有的推理模型在部分 OpenAI 兼容端点上不把思考拆到
 * `reasoning_content`，而是把「…思考…</think>正文」整段当 content 流出来。宿主的
 * text-delta 若原样转发，整段推理就会被当消息泡显示（实机踩到过，用例 1 就是那次的原样文本）。
 *
 * 这个函数出错**不抛异常**：只是把推理显示出来、或反过来把正文吞掉——两种都很难在测试里
 * 靠肉眼发现，所以必须机器守。用例覆盖：真实泄漏串、逐段增长（流式）、大小写、多个闭合标记、
 * 只有开场标记（仍在思考）、无标记（原样）、以及超长防呆（不吞长正文）。
 *
 * 用法：node --import tsx/esm scripts/check-think-strip.mjs
 */
const { stripThink, THINK_SCAN_MAX } = await import('../src/think-strip.ts');

const cases = [];
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  cases.push({ name, ok, actual, expected });
};

// 1) 实机泄漏串（截图里那段）：闭合标记之前是推理，之后才是要显示的话
const LEAK =
  'The user says "好吧" then "去玩吧" (okay, go play). As the pet, respond in character — ' +
  'playful, happy to go play, but also staying available. Keep it short and in Chinese.\n\n' +
  'No tools needed. </think>好嘞主人！那我先去玩啦，有事随时喊我～';
check('真实泄漏串：剥掉推理只留正文', stripThink(LEAK), {
  text: '好嘞主人！那我先去玩啦，有事随时喊我～',
  thinking: true,
  pending: false,
});

// 2) 流式增长：闭合标记到达后必须只剩正文（这正是实机看到"推理被当回复"的那一步）
{
  // 闭合标记出现前的中间态无法与正文区分（见模块头的已知限制），
  // 这里钉的是**闭合后的终态**：从闭合那一刻起，文本必须恰好是最终正文的前缀。
  const answer = '好嘞主人！那我先去玩啦，有事随时喊我～';
  const closeAt = LEAK.indexOf('</think>') + '</think>'.length;
  let bad = null;
  for (let i = closeAt; i <= LEAK.length; i++) {
    const r = stripThink(LEAK.slice(0, i));
    if (r.thinking !== true || !answer.startsWith(r.text)) {
      bad = { i, ...r };
      break;
    }
  }
  cases.push({
    name: '流式：闭合标记之后只剩正文（终态正确）',
    ok: bad === null,
    actual: bad,
    expected: null,
  });
  // 终态本身
  check('流式终态 = 纯正文', stripThink(LEAK).text, answer);
}

// 3) 只有开场标记 → 仍在思考（调用方应显示"正在思考…"）
check('只见开场标记 → pending', stripThink('<thinking>正在想这个问题'), { text: '', thinking: true, pending: true });
check('开场标记在行首空白之后 → 同样 pending', stripThink('  \n<thinking>嗯…'), { text: '', thinking: true, pending: true });

// 4) 开场+闭合成对（大小写不敏感）→ 只留闭合之后的正文
check('<thinking>…</thinking> 成对', stripThink('<thinking>算一下</thinking>答案是 42'), {
  text: '答案是 42',
  thinking: true,
  pending: false,
});
check('大写标记同样识别', stripThink('<THINK>abc</THINK>正文在这'), { text: '正文在这', thinking: true, pending: false });
check('</reasoning> 变体', stripThink('推理内容</reasoning>结论'), { text: '结论', thinking: true, pending: false });

// 5) 无标记 → 原样（绝大多数轮次）
check('没有思考标记 → 原样返回', stripThink('今天天气不错，出去走走吧'), {
  text: '今天天气不错，出去走走吧',
  thinking: false,
  pending: false,
});
check('空串', stripThink(''), { text: '', thinking: false, pending: false });

// 6) 多个闭合标记：以最后一个为准
check('多个闭合标记取最后一个', stripThink('a</think>b</think>c'), { text: 'c', thinking: true, pending: false });
check('闭合标记在最前（模板已吃掉开场）', stripThink('</think>好'), { text: '好', thinking: true, pending: false });

// 7) 防呆：标记出现得极晚 → 不当作思考块，绝不吞长正文
{
  const long = 'x'.repeat(THINK_SCAN_MAX + 1) + '</think>尾';
  check('闭合标记超出扫描上限 → 原文照用', stripThink(long), { text: long, thinking: false, pending: false });
}
{
  const longOpen = '<thinking>' + 'x'.repeat(THINK_SCAN_MAX + 1);
  check('只有开场标记且已超长 → 放弃 pending（显示原文）', stripThink(longOpen), {
    text: longOpen,
    thinking: false,
    pending: false,
  });
}

// 8) 只思考没正文：剥离后为空（上层据此报"模型未返回文本"，而不是显示推理）
check('只有思考段 → 正文为空', stripThink('纯推理没有结论</think>'), {
  text: '',
  thinking: true,
  pending: false,
});

// ---------------------------------------------------------------- 报告
let failed = 0;
for (const c of cases) {
  if (c.ok) {
    console.log(`PASS  ${c.name}  ${JSON.stringify(c.actual).slice(0, 90)}`);
  } else {
    failed++;
    console.log(`FAIL  ${c.name}`);
    console.log(`      期望 ${JSON.stringify(c.expected)}`);
    console.log(`      实际 ${JSON.stringify(c.actual)}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
