// 처음 쓰는 사람을 위한 내보내기 파일 받는 방법. 공식 도움말 기준(2026-11-18 확인):
//   ChatGPT https://help.openai.com/en/articles/7260999 · Claude https://support.claude.com/en/articles/9450526
// 메뉴 이름은 화면 언어에 따라 다르므로 영어 이름을 괄호로 같이 적는다. 도움말이 바뀌면 이 문구도 고칠 것.
export default function ExportGuide() {
  return (
    <details className="guide">
      <summary>내보내기 파일은 어떻게 받나요?</summary>
      <h3>ChatGPT</h3>
      <ol>
        <li>웹(chatgpt.com)에 로그인하고 프로필 메뉴를 눌러 <b>설정(Settings)</b>을 엽니다.</li>
        <li><b>데이터 제어(Data controls)</b>에서 데이터 내보내기(Export data) 옆의 <b>내보내기(Export)</b>를 누르고, 확인 화면에서 <b>내보내기 확인(Confirm export)</b>을 누릅니다. 휴대폰 앱의 설정 → 데이터 제어에서도 할 수 있습니다.</li>
        <li>준비되면 계정 이메일(전화번호로 가입했다면 문자)로 링크가 옵니다. <b>최대 7일</b>까지 걸릴 수 있고, 링크는 받은 뒤 <b>24시간</b> 동안만 열립니다. 같은 계정으로 로그인한 상태에서 내려받습니다.</li>
        <li>받은 zip 파일을 압축을 풀지 말고 그대로 아래에 넣습니다.</li>
      </ol>
      <p className="detail">Business·Enterprise 같은 회사 워크스페이스에서는 직접 내보낼 수 없습니다. 메일이 안 보이면 스팸함도 확인해 주세요. <a href="https://help.openai.com/en/articles/7260999" target="_blank" rel="noreferrer">공식 도움말</a></p>
      <h3>Claude</h3>
      <ol>
        <li>웹(claude.ai) 또는 Claude 데스크톱 앱에서 <b>설정(Settings) → 개인정보(Privacy)</b>로 갑니다. 휴대폰 앱에서는 내보낼 수 없습니다.</li>
        <li><b>데이터 내보내기(Export data)</b>를 누릅니다.</li>
        <li>준비되면 계정 이메일로 링크가 옵니다. 링크는 <b>24시간</b> 동안만, 한 번만 열릴 수 있으니 받자마자 내려받습니다.</li>
        <li>받은 파일 중 이름이 <b>conversations</b>로 시작하는 zip을 아래에 넣습니다(받은 파일을 압축 풀었다면 그 안에 있습니다).</li>
      </ol>
      <p className="detail">Team·Enterprise 요금제는 관리자가 내보내기를 허용해야 버튼이 보입니다. <a href="https://support.claude.com/en/articles/9450526" target="_blank" rel="noreferrer">공식 도움말</a></p>
    </details>
  )
}
