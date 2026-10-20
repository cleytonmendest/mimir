/**
 * Costura única para juntar classes. O código novo importa `cn` daqui; os componentes que o
 * `shadcn add` copia para components/ui importam direto de "cn" (é assim que o CLI os gera).
 * Trocar a biblioteca por trás é mudar esta linha.
 */
export { cn } from 'cn'
