const app = require('./app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`会议助手已启动: http://localhost:${PORT}`);
  console.log('默认管理员账号: admin / admin123');
});
