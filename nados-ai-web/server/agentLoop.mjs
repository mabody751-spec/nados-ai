import { toolRegistry, listTools } from './tools.mjs'
import { callProvider } from './providers.mjs'
import { modeInstructions } from './instructions.mjs'
import { getMode, modeToolsAllowed, modeAllowsFile } from './modes.mjs'

export const MAX_STEPS = 50

const AGENT_SYSTEM_PROMPT = (slug = 'code') => {
  const mode = getMode(slug)
  const allowed = modeToolsAllowed(slug)
  return `أنت وكيل Nados الذكي — وضع «${mode.name}». ${mode.roleDefinition}

الأدوات المتاحة لك في هذا الوضع:
${listTools().filter((tool) => allowed.has(tool.name)).map((tool) => `- ${tool.name}(${Object.keys(tool.params).join(', ')}): ${tool.description}`).join('\n')}

منهجيتك (ReAct):
1. فكّر في المهمة وحدّد الخطوة التالية
2. استخدم أداة عند الحاجة فقط
3. اقرأ النتيجة واستنتج
4. كرر حتى تكتمل المهمة
5. عند الاكتمال أجب مباشرة بلا أدوات

قواعد صارمة:
- استخدم الأداة بصيغة JSON فقط: {"tool": "اسم_الأداة", "params": {...}}
- الأدوات غير المدرجة أعلاه محجوبة في وضعك الحالي
- لا تختلق نتائج أدوات — انتظر النتيجة الفعلية
- حد أقصى ${MAX_STEPS} خطوة
- عند كتابة ملفات: اكتب الكود كاملاً الصالح

أجب إما بنص نهائي (المهمة اكتملت) أو باستدعاء أداة واحد بصيغة JSON صرفة.`
}

export function parseAgentResponse(text) {
  const raw = String(text || '').trim()
  const jsonMatch = /\{[\s\S]*\}/.exec(raw)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed?.tool && toolRegistry[parsed.tool]) {
        return { toolCall: { tool: parsed.tool, params: parsed.params || {} }, content: raw.replace(jsonMatch[0], '').trim() }
      }
    } catch {}
  }
  return { content: raw }
}

export async function runAgentLoop({ task, sessionId = 'sandbox', mode = 'code', onEvent = () => {} }) {
  const started = Date.now()
  const modeDef = getMode(mode)
  const allowedTools = modeToolsAllowed(mode)
  const history = []
  const filesChanged = []
  const toolCallsLog = []
  let finalContent = ''
  let steps = 0

  onEvent({ type: 'agent_start', task, mode: modeDef.slug, modeName: modeDef.name, tools: [...allowedTools] })

  while (steps < MAX_STEPS) {
    steps += 1
    const conversation = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT(modeDef.slug) },
      { role: 'user', content: `المهمة: ${task}` },
      ...history,
    ]

    let response = null
    let lastError = null
    const agentProviders = ['groq', 'nvidia', 'xkiro-minimax-m3-free', 'atria-dawn-1', 'atria-dawn-2', 'nvidia-nemotron-35-lightning', 'xkiro-deepseek-v41-flash-free']
    for (const providerId of agentProviders) {
      try {
        response = await callProvider(providerId, {
          message: conversation.map((item) => (item.role === 'user' ? item.content : '')).filter(Boolean).join('\n\n') || task,
          history: conversation.filter((item) => item.role !== 'user').slice(-10),
          instructions: AGENT_SYSTEM_PROMPT(),
          mode: mode,
        })
        lastError = null
        break
      } catch (error) {
        lastError = error
        continue
      }
    }
    if (!response) {
      onEvent({ type: 'error', message: String(lastError?.message || 'فشل جميع المزوّدين').slice(0, 200) })
      throw lastError || new Error('فشل جميع المزوّدين.')
    }

    const { toolCall, content } = parseAgentResponse(response?.text || '')

    if (!toolCall) {
      finalContent = content || response?.text || ''
      onEvent({ type: 'agent_done', steps, summary: finalContent.slice(0, 300) })
      break
    }

    if (!allowedTools.has(toolCall.tool)) {
      const blocked = { error: `الأداة «${toolCall.tool}» محجوبة في وضع «${modeDef.name}» — الأدوات المسموحة: ${[...allowedTools].join(', ')}` }
      toolCallsLog.push({ step: steps, tool: toolCall.tool, params: toolCall.params, result: blocked, blocked: true })
      onEvent({ type: 'tool_result', step: steps, tool: toolCall.tool, result: blocked })
      history.push(
        { role: 'assistant', content: JSON.stringify({ tool: toolCall.tool, params: toolCall.params }) },
        { role: 'assistant', content: `النتيجة: ${JSON.stringify(blocked)}` },
      )
      history.splice(0, Math.max(0, history.length - 12))
      continue
    }

    if ((toolCall.tool === 'write_file') && !modeAllowsFile(modeDef.slug, toolCall.params?.path)) {
      const blocked = { error: `قيود وضع «${modeDef.name}»: الملفات المسموحة فقط ${modeDef.fileRegex}` }
      toolCallsLog.push({ step: steps, tool: toolCall.tool, params: toolCall.params, result: blocked, blocked: true })
      onEvent({ type: 'tool_result', step: steps, tool: toolCall.tool, result: blocked })
      history.push(
        { role: 'assistant', content: JSON.stringify({ tool: toolCall.tool, params: toolCall.params }) },
        { role: 'assistant', content: `النتيجة: ${JSON.stringify(blocked)}` },
      )
      history.splice(0, Math.max(0, history.length - 12))
      continue
    }

    onEvent({ type: 'tool_call', step: steps, tool: toolCall.tool, params: toolCall.params })

    let result
    try {
      result = await toolRegistry[toolCall.tool].execute(toolCall.params)
      if (toolCall.tool === 'write_file' && result?.written) filesChanged.push(result.path)
    } catch (error) {
      result = { error: String(error?.message || error).slice(0, 300) }
    }

    toolCallsLog.push({ step: steps, tool: toolCall.tool, params: toolCall.params, result })
    onEvent({ type: 'tool_result', step: steps, tool: toolCall.tool, result })

    history.push(
      { role: 'assistant', content: JSON.stringify({ tool: toolCall.tool, params: toolCall.params }) },
      { role: 'assistant', content: `نتيجة الأداة ${toolCall.tool}: ${JSON.stringify(result).slice(0, 1500)}` },
    )
    history.splice(0, Math.max(0, history.length - 12))
  }

  if (steps >= MAX_STEPS && !finalContent) {
    throw new Error('تجاوزت الحلقة الحد الأقصى للخطوات دون اكتمال المهمة.')
  }

  return {
    summary: finalContent,
    filesChanged,
    toolCalls: toolCallsLog,
    steps,
    durationMs: Date.now() - started,
  }
}
