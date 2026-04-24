import { createApp } from "vue";
import App from "./App.vue";
import FileTreeNode from "./components/FileTreeNode.vue";

const app = createApp(App);
app.component("FileTreeNode", FileTreeNode);
app.mount("#app");
