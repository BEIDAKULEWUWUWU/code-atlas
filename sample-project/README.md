# Atlas Todo CLI

一个用于测试 Code Atlas 的极简待办事项命令行项目。

## 运行

```bash
npm start -- add "整理代码地图"
npm start -- list
npm start -- done 1
npm test
```

数据默认保存在系统临时目录，不会污染项目文件。

## 在 Code Atlas 里查看

[data/test-project.json](data/test-project.json) 是这个项目的结构快照。在仓库根目录跑 `npm start`，然后打开：

```
http://localhost:8123/viewer/index.html?data=../sample-project/data/test-project.json
```

改完代码后记得同步这个文件，否则地图显示的还是旧规模。
