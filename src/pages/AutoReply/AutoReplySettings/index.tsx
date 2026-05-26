import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AIReplySetting } from './components/AIReplySetting'
import { KeywordReplySetting } from './components/KeywordReplySetting'
import { SecondaryAutoReplySettings } from './components/SecondaryAutoReplySettings'

export default function AutoReplySettings() {
  const navigate = useNavigate()

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-6 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(-1)}
                title="返回"
                className="mt-0.5 shrink-0"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0">
                <Title title="自动回复设置" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <Tabs defaultValue="keyword" className="space-y-4">
              <Card className="overflow-hidden">
                <div className="border-b px-4 py-3">
                  <TabsList className="grid w-full grid-cols-2 sm:w-72">
                    <TabsTrigger value="keyword">关键词回复</TabsTrigger>
                    <TabsTrigger value="ai">AI回复</TabsTrigger>
                  </TabsList>
                </div>

                <CardContent className="p-4 md:p-5">
                  <TabsContent value="keyword" className="m-0 space-y-4">
                    <KeywordReplySetting />
                  </TabsContent>
                  <TabsContent value="ai" className="m-0 space-y-4">
                    <AIReplySetting />
                  </TabsContent>
                </CardContent>
              </Card>
            </Tabs>

            <SecondaryAutoReplySettings />

            <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">设置会自动保存</p>
              <div className="flex w-full justify-end sm:w-auto">
                <Button variant="outline" onClick={() => navigate(-1)}>
                  返回
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
