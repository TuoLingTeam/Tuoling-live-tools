import { useMemoizedFn } from 'ahooks'
import { Download, Plus, Trash, Upload, X } from 'lucide-react'
import { type ChangeEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAutoReplyConfig } from '@/hooks/useAutoReplyConfig'
import { useToast } from '@/hooks/useToast'
import {
  getCompleteKeywordReplyRules,
  type KeywordReplyRule,
  parseKeywordReplyImportText,
  serializeKeywordReplyRulesCsv,
} from './keywordReplyImportExport'

type Rule = KeywordReplyRule

export function KeywordReplySetting() {
  const { config, updateKeywordRules, updateKeywordReplyEnabled } = useAutoReplyConfig()
  const rules = config.comment.keywordReply.rules
  const [showEditor, setShowEditor] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()
  const exportableRuleCount = useMemo(() => getCompleteKeywordReplyRules(rules).length, [rules])

  const saveRules = useMemoizedFn((rulesToSave = rules) => {
    updateKeywordRules(rulesToSave)
  })

  const keywordReplyEnabled = config.comment.keywordReply.enable
  const handleKeywordEnabledChange = (checked: boolean) => {
    updateKeywordReplyEnabled(checked)
  }

  const addRule = () => {
    saveRules([...rules, { keywords: [], contents: [] }])
  }

  const handleExportRules = useCallback(() => {
    try {
      const csv = serializeKeywordReplyRulesCsv(rules)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `关键词回复规则-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      toast.success({
        title: '导出完成',
        description: `已导出 ${exportableRuleCount} 条关键词回复规则，可用 Excel 或 WPS 打开。`,
        dedupeKey: 'keyword-reply-export',
      })
    } catch (error) {
      toast.warning({
        title: '无法导出',
        description: error instanceof Error ? error.message : '关键词回复规则导出失败。',
        dedupeKey: 'keyword-reply-export-empty',
      })
    }
  }, [exportableRuleCount, rules, toast])

  const handleImportRules = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget
      const file = input.files?.[0]
      input.value = ''
      if (!file) return

      try {
        const text = await file.text()
        const importedRules = parseKeywordReplyImportText(text)
        if (rules.length > 0 && !window.confirm('导入会覆盖当前关键词回复规则，是否继续？')) {
          return
        }

        saveRules(importedRules)
        setShowEditor(false)
        toast.success({
          title: '导入完成',
          description: `已导入 ${importedRules.length} 条关键词回复规则。`,
          dedupeKey: 'keyword-reply-import',
        })
      } catch (error) {
        toast.error({
          title: '导入失败',
          description: error instanceof Error ? error.message : '请检查导入文件格式。',
          dedupeKey: 'keyword-reply-import-failed',
        })
      }
    },
    [rules.length, saveRules, toast],
  )

  const keywordReplyId = useId()

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Switch
          id={keywordReplyId}
          checked={keywordReplyEnabled}
          onCheckedChange={handleKeywordEnabledChange}
        />
        <Label htmlFor={keywordReplyId}>启用关键词回复</Label>
      </div>

      {keywordReplyEnabled && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-sm font-medium">关键词回复规则</h3>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <input
                ref={importInputRef}
                type="file"
                accept=".csv,text/csv,application/json,.json,.txt,text/plain"
                className="hidden"
                onChange={handleImportRules}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => importInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                导入表格
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportRules}
                disabled={exportableRuleCount === 0}
              >
                <Download className="h-4 w-4" />
                导出表格
              </Button>
              <Button variant={'outline'} size="sm" onClick={() => setShowEditor(prev => !prev)}>
                {showEditor ? '普通模式' : '批量编辑'}
              </Button>
              <Button size="sm" onClick={addRule} className="flex items-center gap-1">
                <Plus className="h-4 w-4" /> 添加规则
              </Button>
            </div>
          </div>

          {showEditor ? (
            <KeywordReplyEditor
              rules={rules}
              onSave={rules => {
                updateKeywordRules(rules)
              }}
            />
          ) : (
            <CommonKeywordManager rules={rules} saveRules={saveRules} />
          )}
        </>
      )}
    </div>
  )
}

function CommonKeywordManager({
  rules,
  saveRules,
}: {
  rules: Rule[]
  saveRules: (rules: Rule[]) => void
}) {
  const updateRuleNestedArray = useMemoizedFn(
    (
      ruleIndex: number,
      key: 'keywords' | 'contents',
      updateFn: (currentArray: string[]) => string[],
    ) => {
      const newRules = rules.map((rule, index) => {
        if (index === ruleIndex) {
          const currentArray = rule[key]
          const newArray = updateFn(currentArray)
          return {
            ...rule,
            [key]: newArray,
          }
        }
        return rule
      })

      saveRules(newRules)
    },
  )

  const removeRule = useCallback(
    (index: number) => {
      const newRules = rules.filter((_, i) => i !== index)
      saveRules(newRules)
    },
    [rules, saveRules],
  )

  const addKeyword = useCallback(
    (ruleIndex: number, keyword: string) => {
      const trimmedKeyword = keyword.trim()
      if (!trimmedKeyword) return
      updateRuleNestedArray(ruleIndex, 'keywords', currentKeywords => [
        ...currentKeywords,
        trimmedKeyword,
      ])
    },
    [updateRuleNestedArray],
  )

  const removeKeyword = useCallback(
    (ruleIndex: number, keywordIndex: number) => {
      updateRuleNestedArray(ruleIndex, 'keywords', currentKeywords =>
        currentKeywords.filter((_, kIdx) => kIdx !== keywordIndex),
      )
    },
    [updateRuleNestedArray],
  )

  const addContent = useCallback(
    (ruleIndex: number, content: string) => {
      const trimmedContent = content.trim()
      if (!trimmedContent) return
      updateRuleNestedArray(ruleIndex, 'contents', currentContents => [
        ...currentContents,
        trimmedContent,
      ])
    },
    [updateRuleNestedArray],
  )

  const removeContent = useCallback(
    (ruleIndex: number, contentIndex: number) => {
      updateRuleNestedArray(ruleIndex, 'contents', currentContents =>
        currentContents.filter((_, cIdx) => cIdx !== contentIndex),
      )
    },
    [updateRuleNestedArray],
  )

  return rules.length === 0 ? (
    <div className="text-center py-8 border rounded-md bg-muted/30">
      <p className="text-muted-foreground">暂无规则，请点击"添加规则"创建</p>
    </div>
  ) : (
    <div className="max-h-[min(64vh,760px)] space-y-4 overflow-y-auto overscroll-contain pr-2">
      {rules.map((rule, ruleIndex) => (
        <Card key={ruleIndex} className="border-dashed">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-base">规则 {ruleIndex + 1}</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`删除规则 ${ruleIndex + 1}`}
              onClick={() => removeRule(ruleIndex)}
            >
              <Trash className="h-4 w-4 text-destructive" />
            </Button>
          </CardHeader>

          <CardContent className="grid gap-5 lg:grid-cols-5">
            <div className="min-w-0 space-y-2 lg:col-span-2">
              <h4 className="text-sm font-medium">触发关键词</h4>
              <div className="flex flex-wrap gap-2 mb-2">
                {rule.keywords.map((keyword, keywordIndex) => (
                  <div
                    key={keywordIndex}
                    className="bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm flex min-w-0 items-center"
                  >
                    <span className="min-w-0 break-all">{keyword}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 ml-1 shrink-0"
                      aria-label={`删除关键词 ${keyword}`}
                      onClick={() => removeKeyword(ruleIndex, keywordIndex)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="输入关键词..."
                  className="flex-1"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      addKeyword(ruleIndex, e.currentTarget.value)
                      e.currentTarget.value = ''
                    }
                  }}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={e => {
                    const input = e.currentTarget.previousSibling as HTMLInputElement
                    addKeyword(ruleIndex, input.value)
                    input.value = ''
                  }}
                >
                  添加
                </Button>
              </div>
            </div>

            <div className="min-w-0 space-y-2 lg:col-span-3">
              <h4 className="text-sm font-medium">回复内容</h4>
              <div className="space-y-2 mb-2">
                {rule.contents.map((content, contentIndex) => (
                  <div
                    key={contentIndex}
                    className="bg-muted p-2 rounded-md text-sm flex items-start justify-between group gap-2"
                  >
                    <div className="min-w-0 whitespace-pre-wrap break-words">{content}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`删除回复内容 ${contentIndex + 1}`}
                      onClick={() => removeContent(ruleIndex, contentIndex)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  placeholder="输入回复内容..."
                  className="flex-1"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      addContent(ruleIndex, e.currentTarget.value)
                      e.currentTarget.value = ''
                    }
                  }}
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={e => {
                    const input = e.currentTarget.previousSibling as HTMLInputElement
                    addContent(ruleIndex, input.value)
                    input.value = ''
                  }}
                >
                  添加
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function KeywordReplyEditor({ rules, onSave }: { rules: Rule[]; onSave: (rules: Rule[]) => void }) {
  const toLocalText = useCallback((rules: Rule[]): string => {
    return rules
      .map(rule => {
        return `${rule.keywords.join('/')}|${rule.contents.join('|')}`
      })
      .join('\n')
  }, [])

  const { toast } = useToast()
  const [localText, setLocalText] = useState(toLocalText(rules))
  const [savedText, setSavedText] = useState(localText)

  const lines = useMemo(() => localText.split('\n'), [localText])
  const hasChanges = localText !== savedText

  const toRules = (lines: string[]): Rule[] => {
    const rules = lines.map((line, index) => {
      const items = line.split('|')
      if (items.length < 2) {
        throw new Error(`第 ${index + 1} 行错误：请至少提供一个关键词和一条回复内容`)
      }
      const keywords = items[0].split('/').map(s => s.trim())
      const emptyKeywordIndex = keywords.findIndex(kw => kw.length === 0)
      if (emptyKeywordIndex >= 0) {
        throw new Error(`第 ${index + 1} 行错误：第 ${emptyKeywordIndex + 1} 个关键词是空的`)
      }
      const contents = items.slice(1).map(s => s.trim())
      const emptyContentIndex = contents.findIndex(con => con.length === 0)
      if (emptyContentIndex >= 0) {
        throw new Error(`第 ${index + 1} 行错误：第 ${emptyContentIndex + 1} 条回复内容是空的`)
      }
      return {
        keywords,
        contents,
      }
    })
    return rules
  }

  const handleSaveBtnClick = () => {
    try {
      const rules = toRules(lines)
      onSave(rules)
      setSavedText(localText)
      toast.success({
        title: '规则已保存',
        description: '关键词回复规则已更新。',
        dedupeKey: 'keyword-reply-save',
      })
    } catch (e) {
      if (e instanceof Error) {
        toast.error({
          title: '规则格式有误',
          description: e.message,
          dedupeKey: `keyword-reply-error:${e.message}`,
        })
      } else {
        toast.error({
          title: '保存失败',
          description: '规则保存失败，请检查输入格式后重试。',
          dedupeKey: 'keyword-reply-save-failed',
        })
      }
    }
  }

  useEffect(() => {
    setLocalText(toLocalText(rules))
  }, [rules, toLocalText])

  return (
    <div>
      <div className="flex justify-between">
        <div>
          <div className="text-sm">批量编辑</div>
          <div className="text-muted-foreground text-xs mt-1">
            <p>
              使用 <kbd>|</kbd> 分隔关键字和回复内容， 使用 <kbd>/</kbd> 分隔多个关键字， 使用{' '}
              <kbd>|</kbd> 分隔多个回复内容
            </p>
            <p className="pl-4">如：关键字A/关键字B/关键字C|回复内容a|回复内容b|回复内容c</p>
            <p>每一行对应一条规则，每条回复内容不得超过50个字符</p>
          </div>
        </div>
        <Button className="self-end" onClick={handleSaveBtnClick} disabled={!hasChanges}>
          保存
        </Button>
      </div>

      <div className="flex mt-4">
        <div className="bg-gray-100 text-right px-1 py-1 font-mono text-gray-500 select-none">
          {lines.map((_, i) => (
            <div key={i} className="h-8 px-1 leading-8 flex items-center justify-between group">
              <span className="ml-2">{i + 1}</span>
            </div>
          ))}
        </div>
        <style>
          {`.no-scrollbar::-webkit-scrollbar {
                display: none;
            }`}
        </style>
        <textarea
          className="leading-8 bg-white flex-1 outline-none resize-none px-2 py-1 text-sm whitespace-pre border rounded no-scrollbar"
          value={localText}
          spellCheck="false"
          onChange={e => setLocalText(e.target.value)}
          rows={lines.length || 1}
        />
      </div>
    </div>
  )
}
