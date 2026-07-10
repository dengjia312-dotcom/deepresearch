import { FlaskConical } from 'lucide-react'

interface PrototypeDataNoticeProps {
  topic: string
  className?: string
}

export function PrototypeDataNotice({
  topic,
  className = '',
}: PrototypeDataNoticeProps) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 ${className}`}
      role="note"
    >
      <FlaskConical size={17} className="mt-0.5 shrink-0 text-amber-600" />
      <div>
        <p className="text-sm font-semibold">当前为产品原型演示数据</p>
        <p className="mt-0.5 text-xs leading-5 text-amber-800">
          尚未匹配“{topic}”的预设数据集，当前内容由前端动态占位生成，不代表真实搜索或研究结论。
        </p>
      </div>
    </div>
  )
}
