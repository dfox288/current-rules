<template>
  <main>
    <h1>{{ title }}</h1>
    <button id="toggle" @click="on = !on">{{ on ? 'on' : 'off' }}</button>
  </main>
</template>

<script setup lang="ts">
const title = 'Fixture'
const on = ref(false)
</script>
