import { Title } from '@/components/common/Title'
import { AccountManagementCard } from '@/pages/SubAccount/components/AccountManagementCard'
import { LiveRoomConfigCard } from '@/pages/SubAccount/components/LiveRoomConfigCard'
import { MessageSettingsCard } from '@/pages/SubAccount/components/MessageSettingsCard'
import { TaskControlCard } from '@/pages/SubAccount/components/TaskControlCard'
import { useSubAccountController } from './useSubAccountController'

export default function SubAccount() {
  const controller = useSubAccountController()

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-6 py-6">
          <div className="shrink-0">
            <Title title="小号互动" description="使用多个小号在直播间发送弹幕互动" />
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
            <LiveRoomConfigCard
              liveRoomUrl={controller.liveRoomUrl}
              setLiveRoomUrl={controller.actions.setLiveRoomUrl}
              fetchLiveRoomUrl={controller.fetchLiveRoomUrl}
              handleEnterAllLiveRoom={controller.handleEnterAllLiveRoom}
              connectedCount={controller.connectedCount}
              isEnteringAll={controller.isEnteringAll}
            />

            <TaskControlCard
              verificationNotice={controller.verificationNotice}
              dismissVerificationNotice={() => controller.setVerificationNotice(null)}
              isRunning={controller.isRunning}
              connectedCount={controller.connectedCount}
              enteredCount={controller.enteredCount}
              toggleGroupManager={() =>
                controller.setShowGroupManager(!controller.showGroupManager)
              }
              batchCount={controller.batchCount}
              setBatchCount={value => controller.actions.setBatchCount(value)}
              handleSendBatch={controller.handleSendBatch}
              handleTaskButtonClick={controller.handleTaskButtonClick}
              liveRoomUrl={controller.liveRoomUrl}
              isEnteringAll={controller.isEnteringAll}
              batchProgress={controller.batchProgress}
              enterProgress={controller.enterProgress}
            />

            <AccountManagementCard
              accounts={controller.accounts}
              groups={controller.config.groups}
              selectedGroup={controller.selectedGroup}
              setSelectedGroup={controller.setSelectedGroup}
              showGroupManager={controller.showGroupManager}
              newGroupName={controller.newGroupName}
              setNewGroupName={controller.setNewGroupName}
              liveRoomUrl={controller.liveRoomUrl}
              rotateGroups={controller.config.rotateGroups}
              isAdding={controller.isAdding}
              setIsAdding={controller.setIsAdding}
              newAccountName={controller.newAccountName}
              setNewAccountName={controller.setNewAccountName}
              newAccountPlatform={controller.newAccountPlatform}
              setNewAccountPlatform={controller.setNewAccountPlatform}
              actions={controller.actions}
              handleExportAccounts={controller.handleExportAccounts}
              handleImportAccounts={controller.handleImportAccounts}
              handleAddGroup={controller.handleAddGroup}
              handleRemoveGroup={controller.handleRemoveGroup}
              handleToggleGroup={controller.handleToggleGroup}
              handleAssignToGroup={controller.handleAssignToGroup}
              handleEnterLiveRoom={controller.handleEnterLiveRoom}
              handleClearSavedLoginState={controller.handleClearSavedLoginState}
              handleDisconnectAccount={controller.handleDisconnectAccount}
              handleLoginAccount={controller.handleLoginAccount}
              handleRemoveAccount={controller.handleRemoveAccount}
              handleAddAccount={controller.handleAddAccount}
            />

            <MessageSettingsCard
              config={controller.config}
              actions={controller.actions}
              showPresetLibrary={controller.showPresetLibrary}
              setShowPresetLibrary={controller.setShowPresetLibrary}
              presetCategories={controller.presetCategories}
              selectedPresetCategoryId={controller.selectedPresetCategoryId}
              setSelectedPresetCategoryId={controller.setSelectedPresetCategoryId}
              selectedPresetCategory={controller.selectedPresetCategory}
              updatePresetCategory={controller.updatePresetCategory}
              handleAddPresetCategory={controller.handleAddPresetCategory}
              handleLoadPreset={controller.handleLoadPreset}
              handleRemovePresetCategory={controller.handleRemovePresetCategory}
              handleClearMessages={controller.handleClearMessages}
              onMessageTooLong={controller.showMessageTooLong}
              onKeepLastMessage={controller.showKeepLastMessage}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
