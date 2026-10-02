<template>
  <p>Hello {{ name }}</p>
</template>

<script setup lang="ts">
defineProps<{ name: string }>()
</script>
