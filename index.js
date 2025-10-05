/**
 * n8n 커뮤니티 패키지 엔트리 포인트
 * - 여기서 nodes / credentials 를 export 해야 n8n이 인식함
 * - TS 소스는 빌드 후 dist/* 경로를 require
 */

// 우리 노드(빌드 산출물)를 등록
const { NpmWatch } = require('./dist/nodes/NpmWatch/NpmWatch.node.js');

// (샘플 노드들을 같이 노출하고 싶으면 아래 라인처럼 추가)
// const { ExampleNode } = require('./dist/nodes/ExampleNode/ExampleNode.node.js');
// const { HttpBin }     = require('./dist/nodes/HttpBin/HttpBin.node.js');

module.exports = {
  nodes: [
    new NpmWatch(),
    // new ExampleNode(),
    // new HttpBin(),
  ],
  // credentials: [], // 필요 시 추가
};
