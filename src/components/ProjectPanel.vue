<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '../editor/useEditorStore'

const store = useEditorStore()
const newName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function create() {
  store.createNewProject(newName.value || undefined)
  newName.value = ''
}

function save() {
  store.saveCurrentProject()
}

function pickImportFile() {
  fileInput.value?.click()
}

async function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await store.importProjectFile(file)
  // 清空选择，允许再次导入同一个文件
  input.value = ''
}
</script>

<template>
  <section class="panel side-panel project-panel">
    <h3>项目</h3>
    <p class="hint">数据保存在浏览器 localStorage，可导出文件备份或分享</p>

    <div class="project-actions">
      <input v-model="newName" type="text" placeholder="新项目名称" />
      <button type="button" class="action" @click="create">新建</button>
      <button type="button" class="action primary" @click="save">保存</button>
    </div>

    <div class="file-actions">
      <button type="button" class="action" @click="store.exportActiveProjectFile">
        导出项目文件
      </button>
      <button type="button" class="action" @click="pickImportFile">导入项目文件</button>
      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        class="visually-hidden"
        @change="onImportFileChange"
      />
      <p
        v-if="store.fileTransferMessage"
        class="transfer-message"
        :class="store.fileTransferMessage.kind"
        role="status"
      >
        {{ store.fileTransferMessage.text }}
      </p>
    </div>

    <ul class="project-list">
      <li
        v-for="project in store.projects"
        :key="project.id"
        class="project-item"
        :class="{ active: store.activeProject?.id === project.id }"
      >
        <button type="button" class="name" @click="store.loadProject(project.id)">
          {{ project.name }}
        </button>
        <button
          type="button"
          class="icon danger"
          :disabled="store.projects.length <= 1"
          @click="store.deleteProject(project.id)"
        >
          删
        </button>
      </li>
    </ul>
  </section>
</template>
