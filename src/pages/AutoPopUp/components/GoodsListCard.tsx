import {
  AlertCircle,
  Clock,
  Keyboard,
  Loader2,
  Package,
  Plus,
  RefreshCcw,
  Trash2,
} from 'lucide-react'
import React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { GoodsItemEditDialog } from './GoodsItemEditDialog'
import { GoodsKnowledgeImportPanel } from './GoodsKnowledgeImportPanel'
import ShortcutConfigTab from './ShortcutConfigTab'
import { useGoodsListCardController } from './useGoodsListCardController'

const GoodsListCard = React.memo(
  ({
    initialEditingGoodsId,
    initialAssistContext,
  }: {
    initialEditingGoodsId?: number | null
    initialAssistContext?: {
      title?: string | null
      description?: string | null
      sampleQuestion?: string | null
      filter?: string | null
    }
  }) => {
    const controller = useGoodsListCardController({
      initialEditingGoodsId,
      initialAssistContext,
    })

    return (
      <Card className="overflow-hidden">
        <CardHeader className="bg-muted/50 px-6 py-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            商品列表
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs defaultValue="goods-list" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-9 mb-4">
              <TabsTrigger value="goods-list" className="text-sm">
                <Package className="mr-2 h-4 w-4" />
                商品列表
              </TabsTrigger>
              <TabsTrigger value="shortcuts" className="text-sm">
                <Keyboard className="mr-2 h-4 w-4" />
                快捷键配置
              </TabsTrigger>
            </TabsList>

            <TabsContent value="goods-list" className="space-y-4">
              {controller.showAssistWorkbench && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">
                        {controller.assistTitle || '知识卡补全工作台'}
                      </div>
                      {controller.assistDescription ? (
                        <p className="text-xs leading-5 text-muted-foreground">
                          {controller.assistDescription}
                        </p>
                      ) : null}
                      {controller.assistQuestion ? (
                        <div className="rounded-md bg-background/80 px-2.5 py-2 text-[11px] text-muted-foreground">
                          样本问题：{controller.assistQuestion}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0"
                      onClick={() => controller.setDismissedAssist(true)}
                    >
                      收起
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {controller.initialEditingGoodsId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          const existing = controller.goods.find(
                            item => item.id === controller.initialEditingGoodsId,
                          )
                          if (existing) {
                            controller.setEditingItem(existing)
                          } else if (typeof controller.initialEditingGoodsId === 'number') {
                            controller.setEditingItem({ id: controller.initialEditingGoodsId })
                          }
                        }}
                      >
                        <Package className="mr-1.5 h-3.5 w-3.5" />
                        继续补 {controller.initialEditingGoodsId} 号商品
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => controller.setIsEditing(true)}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      批量补知识卡
                    </Button>
                    <Button
                      variant={controller.assistFilter === 'all' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8"
                      onClick={() => controller.setAssistFilter('all')}
                    >
                      全部商品
                    </Button>
                    <Button
                      variant={controller.assistFilter === 'faq-missing' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8"
                      onClick={() => controller.setAssistFilter('faq-missing')}
                    >
                      只看缺 FAQ
                    </Button>
                    <Button
                      variant={
                        controller.assistFilter === 'price-stock-missing' ? 'default' : 'outline'
                      }
                      size="sm"
                      className="h-8"
                      onClick={() => controller.setAssistFilter('price-stock-missing')}
                    >
                      只看缺价格/库存
                    </Button>
                    <Button
                      variant={controller.assistFilter === 'needs-basics' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8"
                      onClick={() => controller.setAssistFilter('needs-basics')}
                    >
                      只看待完善
                    </Button>
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    当前筛选：
                    {controller.assistFilter === 'faq-missing'
                      ? '缺 FAQ'
                      : controller.assistFilter === 'price-stock-missing'
                        ? '缺价格/库存'
                        : controller.assistFilter === 'needs-basics'
                          ? '待完善'
                          : '全部商品'}
                    ，共 {controller.filteredGoods.length} 个商品。
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm">商品序号</Label>
                    <p className="text-xs text-muted-foreground">
                      {controller.isEditing
                        ? '支持逗号、空格或换行分隔多个序号'
                        : '点击商品标签可设置单独的弹窗时间'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!controller.isEditing ? (
                      <>
                        {controller.goods.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => controller.setEditingItem(controller.goods[0])}
                          >
                            <Clock className="mr-1.5 h-3.5 w-3.5" />
                            设置时间
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => void controller.handleAutoFill()}
                          disabled={controller.isAutoFilling}
                        >
                          {controller.isAutoFilling ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          自动填充
                        </Button>
                        {controller.showSampleAction && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={controller.handleAddSample}
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            添加示例
                          </Button>
                        )}
                        {controller.goods.length > 0 && (
                          <Button
                            variant="subtle"
                            size="sm"
                            className="h-8"
                            onClick={controller.handleClear}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            清空
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={controller.handleCancel}
                        >
                          取消
                        </Button>
                        <Button size="sm" className="h-8" onClick={controller.handleSave}>
                          保存
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {controller.isEditing ? (
                  <Textarea
                    value={controller.inputValue}
                    onChange={e => controller.setInputValue(e.target.value)}
                    placeholder="输入商品序号，如：1, 2, 3, 4, 5"
                    className="min-h-[120px] font-mono text-sm"
                  />
                ) : (
                  <div
                    onClick={controller.handleStartEdit}
                    className="ui-hover-surface min-h-[120px] cursor-text rounded-lg border bg-muted/30 p-4"
                  >
                    {controller.filteredGoods.length > 0 ? (
                      <TooltipProvider>
                        <div className="flex flex-wrap gap-2">
                          {controller.filteredGoods.map(item => (
                            <Tooltip key={item.id}>
                              <TooltipTrigger asChild>
                                <div
                                  onClick={e => {
                                    e.stopPropagation()
                                    controller.setEditingItem(item)
                                  }}
                                  className="ui-hover-item inline-flex max-w-[16rem] cursor-pointer items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary"
                                >
                                  <span>#{item.id}</span>
                                  {item.title ? (
                                    <span className="max-w-28 truncate text-primary/80">
                                      {item.title}
                                    </span>
                                  ) : (
                                    <span className="text-primary/60">未命名商品</span>
                                  )}
                                  {item.priceText ? (
                                    <span className="max-w-20 truncate rounded bg-background/50 px-1.5 py-0.5 text-[11px] text-foreground/80">
                                      {item.priceText}
                                    </span>
                                  ) : null}
                                  {item.faq?.length ? (
                                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-400">
                                      FAQ {item.faq.length}
                                    </span>
                                  ) : null}
                                  {item.interval && <Clock className="h-3 w-3 text-primary/70" />}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                <p>商品 #{item.id}</p>
                                {item.title ? (
                                  <p className="text-xs text-foreground/90">{item.title}</p>
                                ) : null}
                                {item.priceText ? (
                                  <p className="text-xs text-muted-foreground">
                                    价格: {item.priceText}
                                  </p>
                                ) : null}
                                {item.promoText ? (
                                  <p className="text-xs text-muted-foreground">
                                    优惠: {item.promoText}
                                  </p>
                                ) : null}
                                {item.highlights?.length ? (
                                  <p className="text-xs text-muted-foreground">
                                    卖点: {item.highlights.slice(0, 3).join('、')}
                                  </p>
                                ) : null}
                                {item.interval ? (
                                  <p className="text-xs text-muted-foreground">
                                    间隔: {Math.round(item.interval[0] / 1000)}-
                                    {Math.round(item.interval[1] / 1000)}秒
                                  </p>
                                ) : (
                                  <p className="text-xs text-muted-foreground">使用默认间隔</p>
                                )}
                                <p className="text-xs text-primary mt-1">点击设置</p>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </TooltipProvider>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                        <Package className="h-8 w-8 opacity-50" />
                        <span className="text-sm">点击此处添加商品序号</span>
                        <span className="text-xs">支持批量粘贴，如：1, 2, 3, 4, 5</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    商品序号对应直播中控台中的商品顺序。连接中控台后可点“自动填充”读取当前商品序号；点击商品标签可设置单独的弹窗间隔。
                  </span>
                </div>

                <GoodsKnowledgeImportPanel
                  importText={controller.importText}
                  setImportText={controller.setImportText}
                  handleCopyTemplate={controller.handleCopyTemplate}
                  handleExportKnowledge={controller.handleExportKnowledge}
                  handleImportKnowledge={controller.handleImportKnowledge}
                />
              </div>
            </TabsContent>

            <TabsContent value="shortcuts">
              <ShortcutConfigTab />
            </TabsContent>
          </Tabs>
        </CardContent>

        {controller.editingItem && (
          <GoodsItemEditDialog
            item={controller.editingItem}
            allGoods={controller.goods}
            defaultInterval={controller.defaultInterval}
            onSave={controller.handleUpdateItem}
            onClose={() => controller.setEditingItem(null)}
            onScanKnowledge={controller.handleScanKnowledge}
          />
        )}
      </Card>
    )
  },
)

export default GoodsListCard
