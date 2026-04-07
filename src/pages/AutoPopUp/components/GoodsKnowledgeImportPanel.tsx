import { Copy, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type GoodsKnowledgeImportPanelProps = {
  importText: string
  setImportText: (value: string) => void
  handleCopyTemplate: () => void
  handleExportKnowledge: () => void
  handleImportKnowledge: () => void
}

export function GoodsKnowledgeImportPanel({
  importText,
  setImportText,
  handleCopyTemplate,
  handleExportKnowledge,
  handleImportKnowledge,
}: GoodsKnowledgeImportPanelProps) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="space-y-0.5">
        <Label className="text-sm">批量导入商品知识</Label>
        <p className="text-xs text-muted-foreground">
          每个商品用空行分隔，首行写商品号，后面按“字段: 内容”填写。
        </p>
      </div>
      <Textarea
        value={importText}
        onChange={e => setImportText(e.target.value)}
        className="min-h-[12rem] font-mono text-xs"
        placeholder={
          '3号链接\n标题: 胶原修护面霜\n简称: 修护面霜\n价格: 99元\n优惠: 拍2件减20\n卖点: 保湿, 修护屏障, 适合干皮\n别名: 面霜, 修护霜\nFAQ: 适合谁 => 更适合干皮和混干皮 | 怎么用 => 洁面后取适量涂抹\n\n4号链接 标题=舒缓精华 价格=129元 卖点=舒缓,维稳 FAQ=适合谁 => 敏感肌也可用'
        }
      />
      <div className="flex justify-end">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyTemplate}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            复制模板
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportKnowledge}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            导出知识卡
          </Button>
          <Button variant="outline" size="sm" onClick={handleImportKnowledge}>
            批量导入知识卡
          </Button>
        </div>
      </div>
    </div>
  )
}
