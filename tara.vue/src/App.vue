<template>
  <div>
    <Navbar />
  </div>
  <div class="container-fluid">
    <main>
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import Navbar from '@/components/Navbar.vue'
import "vue-toastification/dist/index.css";

</script>